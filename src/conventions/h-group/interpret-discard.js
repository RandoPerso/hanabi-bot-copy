const { Card } = require('../../basics/Card.js');
const { find_known_trash } = require('../../basics/helper.js');
const { find_chop } = require('./hanabi-logic.js');
const { isTrash, playableAway, visibleFind, isBasicTrash } = require('../../basics/hanabi-util.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_sarcastic(hand, suitIndex, rank) {
	// First, try to see if there's already a card that is known/inferred to be that identity
	const known_sarcastic = hand.findCards(suitIndex, rank, { symmetric: true, infer: true });
	if (known_sarcastic.length > 0) {
		return known_sarcastic;
	}
	// Otherwise, find all cards that could match that identity
	return hand.filter(c =>
		c.clued && c.possible.some(p => p.matches(suitIndex, rank)) &&
		!(c.inferred.length === 1 && c.inferred[0].rank < rank));		// Do not sarcastic on connecting cards
}

function undo_hypo_stacks(state, playerIndex, suitIndex, rank) {
	logger.info(`${state.playerNames[playerIndex]} discarded useful card ${Utils.logCard({suitIndex, rank})}, setting hypo stack ${rank - 1}`);
	if (state.hypo_stacks[suitIndex] >= rank) {
		state.hypo_stacks[suitIndex] = rank - 1;
	}
}

function apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank) {
	// Need to add the inference back if it was previously eliminated due to good touch
	for (const s of sarcastic) {
		s.union('inferred', [new Card(suitIndex, rank)]);
	}

	const playable = (card) => {
		return card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0);
	};

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(s => !playable(s))) {
		undo_hypo_stacks(state, playerIndex, suitIndex, rank);
	}
}

function interpret_discard(state, action, card) {
	const { order, playerIndex, rank, suitIndex, failed } = action;

	// Early game and discard wasn't known trash or misplay, so end early game
	if (state.early_game && !isTrash(state, playerIndex, suitIndex, rank, order) && !action.failed) {
		logger.warn('ending early game from discard of', Utils.logCard(card));
		state.early_game = false;
	}

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!card.rewinded && (failed || (!card.matches_inferences() && !isTrash(state, state.ourPlayerIndex, card.suitIndex, card.rank, card.order)))) {
		logger.info('all inferences', card.inferred.map(c => Utils.logCard(c)));
		if (state.rewind(state, card.reasoning.pop(), playerIndex, order, suitIndex, rank, card.finessed)) {
			return;
		}
	}

	// Discarding a useful card
	if ((card.clued || card.chop_moved || card.finessed) && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		const duplicates = visibleFind(state, playerIndex, suitIndex, rank);

		// Card was bombed
		if (failed) {
			undo_hypo_stacks(state, playerIndex, suitIndex, rank);
		}
		else {
			// Sarcastic discard to us
			if (duplicates.length === 0) {
				const sarcastic = find_sarcastic(state.hands[state.ourPlayerIndex], suitIndex, rank);

				if (sarcastic.length === 1) {
					sarcastic[0].inferred = [new Card(suitIndex, rank)];
				}
				else {
					apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank);
				}
			}
			// Sarcastic discard to other
			else {
				for (let i = 1; i < state.numPlayers; i++) {
					const receiver = (state.ourPlayerIndex + i) % state.numPlayers;
					const sarcastic = find_sarcastic(state.hands[receiver], suitIndex, rank);

					if (sarcastic.some(c => c.matches(suitIndex, rank) && c.clued)) {
						// The matching card must be the only possible option in the hand to be known sarcastic
						if (sarcastic.length === 1) {
							sarcastic[0].inferred = [new Card(suitIndex, rank)];
							logger.info(`writing ${Utils.logCard({suitIndex, rank})} from sarcastic discard`);
						}
						else {
							apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank);
							logger.info('unknown sarcastic');
						}
						return;
					}
				}
				logger.warn(`couldn't find a valid target for sarcastic discard`);
			}
		}
		return;
	}

	// Check for positional discard.
	// Step 0: Ignore our own discards and bombs (positional misplay can come later).
	if ((playerIndex !== state.ourPlayerIndex) && !action.failed) {
		const discarded_card = Utils.objClone(card);
		// Step 1: Recreate the hand BEFORE the discard happened.
		// Note: Separate this into a separate function?
		let previous_hand = Utils.objClone(state.hands[playerIndex]);
		let discarded_slot = -1;
		/*
		// Remove the newly drawn card.
		previous_hand.shift();
		*/
		// Cycle through the cards, comparing the discarded card's order to find where it belongs
		for (let card_index = 0; card_index < previous_hand.length; card_index++) {
			const previous_card = previous_hand[card_index];
			logger.info(`comparing ${Utils.logCard(discarded_card)} (order ${discarded_card.order}) and ${Utils.logCard(previous_card)} (order ${previous_card.order})`);
			if (order > previous_card.order) {
				previous_hand.splice(card_index, 0, discarded_card);
				discarded_slot = card_index;
				break;
			}
		}
		// If the card was never inserted, insert it at the end.
		if (discarded_slot === -1) {
			discarded_slot = previous_hand.length;
			previous_hand.push(discarded_card);
		}
		logger.info(`inserted ${Utils.logCard(discarded_card)} into slot ${discarded_slot}`);
		// Step 2: Compare the discarded card compared to the correct card to discard.
		// Left-most clued trash, then chop.
		let previousChopIndex = -1;
		for (let i = 0; i < previous_hand.length; i++) {
			const previous_card = previous_hand[i];
			let inference = false;
			for (let j = 0; j < previous_card.inferred.length; j++) {
				if (!isBasicTrash(state, previous_card.inferred[j].suitIndex, previous_card.inferred[j].rank)) {
					inference = true;
					break;
				}
			}
			if (!inference) {
				previousChopIndex = i;
				logger.info(`found known trash in slot ${i} (${Utils.logCard(previous_hand[i])})`);
				break;
			}
		}
		if (previousChopIndex === -1) {
			previousChopIndex = find_chop(previous_hand);
			logger.info(`no card found, using slot ${previousChopIndex} as chop`);
		}
		if (previousChopIndex !== discarded_slot) {
			// Step 3: Check everyone else's hand to see if they have a playable card in that slot.
			// TODO: Fix ambiguous positional discard.
			let possible = [];
			for (let search_player = 0; search_player < state.numPlayers; search_player++) {
				// Ignore our own hand and the giver's hand
				if ((search_player === state.ourPlayerIndex) || (search_player === playerIndex)) {
					continue;
				}
				const other_card = state.hands[search_player][discarded_slot];
				const playable_away = playableAway(state, other_card.suitIndex, other_card.rank);
				const hypo_away = other_card.rank - (state.hypo_stacks[other_card.suitIndex] + 1);

				if ((playable_away === 0) && (hypo_away === 0) && !other_card.clued && !other_card.finessed) {
					possible.push(search_player);
					logger.info(`found immediate playable ${Utils.logCard(other_card)} in player index ${search_player} hand`);
				}
			}
			// Step 4: Generate all immediate playables.
			const number_of_stacks = state.play_stacks.length;
			let all_playable = [];
			for (let stackIndex = 0; stackIndex < number_of_stacks; stackIndex++) {
				if (state.play_stacks[stackIndex] === state.hypo_stacks[stackIndex]) {
					all_playable.push({suitIndex: stackIndex, rank: state.play_stacks[stackIndex]+1});
				}
			}
			// Eliminate possibilities.
			if (possible.length === 0) {
				// If no one has a playable, mark my card as the possible discarded.
				logger.info(`could not find playable, assuming own hand`);
				possible.push(state.ourPlayerIndex);
			}
			// Step 5: Note down card(s) as playable.
			for (let other_index = 0; other_index < possible.length; other_index++) {
				const possible_card = state.hands[possible[other_index]][discarded_slot];
				// possible_card.inferred = Utils.objClone(state.hands[possible[other_index]][discarded_slot].possible);
				possible_card.intersect('inferred', all_playable);
				possible_card.finessed = true;
			}
		}
	}
}

module.exports = { interpret_discard };
