const { Card } = require('../../basics/Card.js');
const { find_known_trash } = require('../../basics/helper.js');
const { find_chop } = require('./hanabi-logic.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_sarcastic(hand, suitIndex, rank) {
	// First, try to see if there's already a card that is known/inferred to be that identity
	const known_sarcastic = Utils.handFindInfer(hand, suitIndex, rank);
	if (known_sarcastic.length > 0) {
		return known_sarcastic;
	}
	// Otherwise, find all cards that could match that identity
	return hand.filter(c => c.clued && c.possible.some(p => p.matches(suitIndex, rank)));
}

function undo_hypo_stacks(state, playerIndex, suitIndex, rank) {
	logger.info(`${state.playerNames[playerIndex]} discarded useful card ${Utils.logCard(suitIndex, rank)}, setting hypo stack ${rank - 1}`);
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
		return card.inferred.every(c => Utils.playableAway(state, c.suitIndex, c.rank) === 0);
	};

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(s => !playable(s))) {
		undo_hypo_stacks(state, playerIndex, suitIndex, rank);
	}
}

function interpret_discard(state, action, card) {
	const { order, playerIndex, rank, suitIndex, failed } = action;

	// Check for positional discard.
	// TODO: Find where this fits the best.

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
			console.log("comparing " + Utils.logCard(discarded_card.suitIndex, discarded_card.rank) + " and " + Utils.logCard(previous_hand[card_index].suitIndex, previous_hand[card_index].rank));
			if (order > previous_hand[card_index].order) {
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
		console.log(discarded_slot);
		// Step 2: Compare the discarded card compared to the chop.
		// Note: Hm, will the find_chop function return the chop the giving player sees as their chop?
		// TODO: Make the line find a more "correct" chop when all trash since clued trash has higher discard priority than unclued trash
		// Duct Tape fix: Just check if whole hand is trash.
		const previousChopIndex = find_chop(previous_hand);
		let playable_hand = 0;
		for (let card_index = 0; card_index < previous_hand.length; card_index++) {
			const temp_card = previous_hand[card_index]
			if (Utils.playableAway(state, temp_card.suitIndex, temp_card.rank) >= 0) {
				playable_hand = 1;
				break;
			}
		}
		if ((previousChopIndex !== discarded_slot) && (playable_hand === 0)){
			// Step 3: Check everyone else's hand to see if they have a playable card in that slot.
			// TODO: Fix ambiguous positional discard.
			let possible = [];
			for (let search_player = 0; search_player < state.numPlayers; search_player++) {
				// Ignore our own hand and the giver's hand
				if ((search_player === state.ourPlayerIndex) || (search_player === playerIndex)) {
					continue;
				}
				let other_card = state.hands[search_player][discarded_slot];
				let playable_away = Utils.playableAway(state, other_card.suitIndex, other_card.rank);
				let hypo_away = other_card.rank - (state.hypo_stacks[other_card.suitIndex] + 1);

				if ((playable_away === 0) && (hypo_away === 0) && !other_card.clued && !other_card.finessed) {
					possible.push(search_player);
				}
			}
			// Step 4: Generate all immediate playables.
			let number_of_stacks = state.play_stacks.length;
			let all_playable = [];
			for (let stackIndex = 0; stackIndex < number_of_stacks; stackIndex++) {
				if (state.play_stacks[stackIndex] === state.hypo_stacks[stackIndex]) {
					all_playable.push({suitIndex: stackIndex, rank: state.play_stacks[stackIndex]+1});
				}
			}
			// Eliminate possibilities.
			if (possible.length === 0) {
				// If no one has a playable, mark my card as the possible discarded.
				possible.push(state.ourPlayerIndex);
			}
			console.log(possible);
			// Step 5: Note down card(s) as playable.
			for (let other_index = 0; other_index < possible.length; other_index++) {
				const possible_card = state.hands[possible[other_index]][discarded_slot];
				// possible_card.inferred = Utils.objClone(state.hands[possible[other_index]][discarded_slot].possible);
				possible_card.intersect('inferred', all_playable);
				possible_card.finessed = true;
			}
		}
	}
	

	const trash = find_known_trash(state, playerIndex);
	// Early game and discard wasn't known trash or misplay, so end early game
	if (state.early_game && !trash.some(c => c.matches(suitIndex, rank)) && !action.failed) {
		state.early_game = false;
	}

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!card.rewinded && (failed || (!card.matches_inferences() && !Utils.isTrash(state, card.suitIndex, card.rank, card.order)))) {
		logger.info('all inferences', card.inferred.map(c => c.toString()));
		state.rewind(state, card.reasoning.pop(), playerIndex, order, suitIndex, rank, card.finessed);
		return;
	}

	// Discarding a useful card
	if (state.hypo_stacks[suitIndex] >= rank && state.play_stacks[suitIndex] < rank) {
		const duplicates = Utils.visibleFind(state, playerIndex, suitIndex, rank);

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

					if (sarcastic.some(c => c.matches(suitIndex, rank))) {
						// The matching card must be the only possible option in the hand to be known sarcastic
						if (sarcastic.length === 1) {
							sarcastic[0].inferred = [new Card(suitIndex, rank)];
							logger.info(`writing ${Utils.logCard(suitIndex, rank)} from sarcastic discard`);
						}
						else {
							apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank);
							logger.info('unknown sarcastic');
						}
						break;
					}
				}
			}
		}
	}
}

module.exports = { interpret_discard };
