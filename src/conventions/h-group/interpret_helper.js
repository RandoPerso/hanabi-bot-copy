const { find_finesse_pos } = require('./hanabi-logic.js');
const { CLUE } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function find_focus_possible(state, giver, target, clue, chop) {
	const focus_possible = [];
	logger.info('play/hypo/max stacks in clue interpretation:', state.play_stacks, state.hypo_stacks, state.max_ranks);

	if (clue.type === CLUE.COLOUR) {
		const suitIndex = clue.value;
		let next_playable_rank = state.hypo_stacks[suitIndex] + 1;

		// Play clue
		const connections = [];

		// Try looking for a connecting card
		let connecting = find_connecting(state, giver, target, suitIndex, next_playable_rank);

		while (connecting !== undefined) {
			// TODO: Use the reacting person to see if they do something urgent instead of playing into finesse
			const { type } = connecting;

			if (type === 'finesse') {
				// Even if a finesse is possible, it might not be a finesse
				focus_possible.push({ suitIndex, rank: next_playable_rank, save: false, connections: Utils.objClone(connections) });
			}

			next_playable_rank++;
			connections.push(connecting);
			connecting = find_connecting(state, giver, target, suitIndex, next_playable_rank);
		}

		// Our card could be the final rank that we can't find
		focus_possible.push({ suitIndex, rank: next_playable_rank, save: false, connections });

		// Save clue on chop (5 save cannot be done with number)
		if (chop) {
			for (let rank = next_playable_rank + 1; rank < 5; rank++) {
				// Check if card is critical and not visible in anyone's hand
				if (Utils.isCritical(state, suitIndex, rank)) {
					focus_possible.push({ suitIndex, rank, save: true, connections: [] });
				}
			}
		}
	}
	else {
		const rank = clue.value;

		// Play clue
		for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
			let stack_rank = state.hypo_stacks[suitIndex] + 1;
			const connections = [];

			if (rank === stack_rank) {
				focus_possible.push({ suitIndex, rank, save: false, connections });
			}
			else if (rank > stack_rank) {
				// Try looking for all connecting cards
				let connecting = find_connecting(state, giver, target, suitIndex, stack_rank);

				while (connecting !== undefined) {
					connections.push(connecting);
					stack_rank++;
					connecting = find_connecting(state, giver, target, suitIndex, stack_rank);
				}

				// Connected cards can stack up to this rank
				if (rank === stack_rank) {
					focus_possible.push({ suitIndex, rank, save: false, connections });
				}
			}
		}

		// Save clue on chop
		if (chop) {
			for (let suitIndex = 0; suitIndex < state.num_suits; suitIndex++) {
				// Don't need to consider save on playable cards
				if (Utils.isPlayable(state, suitIndex, rank)) {
					continue;
				}

				let save2 = false;

				// Determine if it's a 2 save
				if (rank === 2) {
					const duplicates = Utils.visibleFind(state, target, suitIndex, rank);

					// No duplicates found, so can be a 2 save
					if (duplicates.length === 0) {
						save2 = true;
					}
					// Both duplicates found, so can't be a 2 save
					else if (duplicates.length === 2) {
						continue;
					}
					else {
						// Can be a 2 save if the other 2 is in the giver's hand
						save2 = state.hands[giver].some(c => c.order === duplicates[0].order);
					}
				}

				if (Utils.isCritical(state, suitIndex, rank) || save2) {
					focus_possible.push({ suitIndex, rank, save: true, connections: [] });
				}
			}
		}
	}
	return focus_possible;
}

function find_connecting(state, giver, target, suitIndex, rank) {
	logger.info('looking for connecting', Utils.logCard(suitIndex, rank));

	if (state.discard_stacks[suitIndex][rank - 1] === Utils.CARD_COUNT[rank - 1]) {
		logger.info('all cards in trash');
		return;
	}

	for (let i = 0; i < state.numPlayers; i++) {
		const hand = state.hands[i];

		const known_connecting = hand.find(card =>
			(card.possible.length === 1 && card.possible[0].matches(suitIndex, rank)) ||
			(card.inferred.length === 1 && card.inferred[0].matches(suitIndex, rank)) // && i === state.ourPlayerIndex) ?
		);

		if (known_connecting !== undefined) {
			logger.info(`found known ${Utils.logCard(suitIndex, rank)} in ${state.playerNames[i]}'s hand`);
			return { type: 'known', reacting: i, card: known_connecting };
		}
	}

	for (let i = 0; i < state.numPlayers; i++) {
		if (i === giver || i === state.ourPlayerIndex) {
			continue;
		}
		else {
			// Try looking through another player's hand (known to giver) (target?)
			const hand = state.hands[i];

			const prompt_pos = hand.findIndex(c => c.clued && !c.newly_clued && (c.suitIndex === suitIndex || c.rank === rank));
			const finesse_pos = find_finesse_pos(hand);

			if (prompt_pos !== -1 && hand[prompt_pos].matches(suitIndex, rank)) {
				logger.info(`found prompt ${hand[prompt_pos].toString()} in ${state.playerNames[i]}'s hand`);
				return { type: 'prompt', reacting: i, card: hand[prompt_pos], self: false };
			}
			// Prompt takes priority over finesse
			else if (finesse_pos !== -1 && hand[finesse_pos].matches(suitIndex, rank)) {
				logger.info(`found finesse ${hand[finesse_pos].toString()} in ${state.playerNames[i]}'s hand`);
				return { type: 'finesse', reacting: i, card: hand[finesse_pos], self: false };
			}
		}
	}
}

function find_own_finesses(state, giver, target, suitIndex, rank) {
	// We cannot finesse ourselves
	if (giver === state.ourPlayerIndex) {
		return { feasible: false, connections: [] };
	}

	logger.info('finding finesse for (potentially) clued card', Utils.logCard(suitIndex, rank));
	const our_hand = state.hands[state.ourPlayerIndex];
	const connections = [];

	const already_prompted = [];
	let already_finessed = 0;

	for (let i = state.hypo_stacks[suitIndex] + 1; i < rank; i++) {
		if (state.discard_stacks[suitIndex][i - 1] === Utils.CARD_COUNT[i - 1]) {
			logger.info(`impossible to find ${Utils.logCard(suitIndex, i)}, both cards in trash`);
			break;
		}

		const other_connecting = find_connecting(state, giver, target, suitIndex, i);
		if (other_connecting !== undefined) {
			connections.push(other_connecting);
		}
		else {
			const prompted = our_hand.find(c => c.clued && !already_prompted.includes(c.order) && c.inferred.some(inf => inf.matches(suitIndex, i)));
			if (prompted !== undefined) {
				logger.info('found prompt in our hand');
				connections.push({ type: 'prompt', card: prompted, self: true });
				already_prompted.push(prompted.order);
			}
			else {
				const finesse_pos = find_finesse_pos(our_hand, already_finessed);

				if (finesse_pos !== -1 && our_hand[finesse_pos].possible.some(c => c.matches(suitIndex, i))) {
					logger.info('found finesse in our hand');
					connections.push({ type: 'finesse', card: our_hand[finesse_pos], self: true });
					already_finessed++;
				}
				else {
					break;
				}
			}
		}
	}
	return { feasible: connections.length === rank - state.hypo_stacks[suitIndex] - 1, connections };
}

module.exports = { find_focus_possible, find_connecting, find_own_finesses };