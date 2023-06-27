import { LEVEL } from './h-constants.js';
import { Card } from '../../basics/Card.js';
import { isTrash, playableAway, visibleFind, isBasicTrash } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logCard } from '../../tools/log.js';
import { find_chop } from './hanabi-logic.js';
import * as Basics from '../../basics.js';
import * as Utils from '../../tools/util.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 */

/**
 * Returns the cards in hand that could be targets for a sarcastic discard.
 * @param {Hand} hand
 * @param {number} suitIndex
 * @param {number} rank
 */
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

/**
 * Reverts the hypo stacks of the given suitIndex to the given rank - 1, if it was originally above that.
 * @param {State} state
 * @param {number} playerIndex
 * @param {number} suitIndex
 * @param {number} rank
 */
function undo_hypo_stacks(state, playerIndex, suitIndex, rank) {
	logger.info(`${state.playerNames[playerIndex]} discarded useful card ${logCard({suitIndex, rank})}, setting hypo stack ${rank - 1}`);
	if (state.hypo_stacks[suitIndex] >= rank) {
		state.hypo_stacks[suitIndex] = rank - 1;
	}
}

/**
 * Adds the sarcastic discard inference to the given set of sarcastic cards.
 * @param {State} state
 * @param {Card[]} sarcastic
 * @param {number} playerIndex
 * @param {number} suitIndex
 * @param {number} rank
 */
function apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank) {
	// Need to add the inference back if it was previously eliminated due to good touch
	for (const s of sarcastic) {
		s.union('inferred', [new Card(suitIndex, rank)]);
	}

	/** @param {Card} card */
	const playable = (card) => {
		return card.inferred.every(c => playableAway(state, c.suitIndex, c.rank) === 0);
	};

	// Mistake discard or sarcastic with unknown transfer location (and not all playable)
	if (sarcastic.length === 0 || sarcastic.some(s => !playable(s))) {
		undo_hypo_stacks(state, playerIndex, suitIndex, rank);
	}
}

/**
 * Interprets (writes notes) for a discard of the given card.
 * @param {State} state
 * @param {import('../../types.js').DiscardAction} action
 * @param {Card} card
 */
export function interpret_discard(state, action, card) {
	const { order, playerIndex, rank, suitIndex, failed } = action;

	const previousState = state.minimalCopy();
	Basics.onDiscard(state, action);

	// End early game?
	if (state.early_game && !action.failed && !card.clued) {
		logger.warn('ending early game from discard of', logCard(card));
		state.early_game = false;
	}

	// If bombed or the card doesn't match any of our inferences (and is not trash), rewind to the reasoning and adjust
	if (!card.rewinded && (failed || (!card.matches_inferences() && !isTrash(state, state.ourPlayerIndex, card.suitIndex, card.rank, card.order)))) {
		logger.info('all inferences', card.inferred.map(c => logCard(c)));
		const action_index = card.reasoning.pop();
		if (action_index !== undefined && state.rewind(action_index, { type: 'identify', order, playerIndex, suitIndex, rank }, card.finessed)) {
			return;
		}
	}

	// Discarding a useful card
	if ((card.clued || card.chop_moved || card.finessed) && rank > state.play_stacks[suitIndex] && rank <= state.max_ranks[suitIndex]) {
		logger.warn('discarded useful card!');
		const duplicates = visibleFind(state, playerIndex, suitIndex, rank);

		// Card was bombed
		if (failed) {
			undo_hypo_stacks(state, playerIndex, suitIndex, rank);
		}
		else {
			// Unknown sarcastic discard to us
			if (duplicates.length === 0) {
				const sarcastic = find_sarcastic(state.hands[state.ourPlayerIndex], suitIndex, rank);

				if (sarcastic.length === 1) {
					const action_index = sarcastic[0].drawn_index;
					if (!sarcastic[0].rewinded && state.rewind(action_index, { type: 'identify', order: sarcastic[0].order, playerIndex: state.ourPlayerIndex, suitIndex, rank })) {
						return;
					}
				}
				else {
					apply_unknown_sarcastic(state, sarcastic, playerIndex, suitIndex, rank);
				}
			}
			// Sarcastic discard to other (or known sarcastic discard to us)
			else {
				for (let i = 0; i < state.numPlayers; i++) {
					const receiver = (state.ourPlayerIndex + i) % state.numPlayers;
					const sarcastic = find_sarcastic(state.hands[receiver], suitIndex, rank);

					if (sarcastic.some(c => c.matches(suitIndex, rank, { infer: receiver === state.ourPlayerIndex }) && c.clued)) {
						// The matching card must be the only possible option in the hand to be known sarcastic
						if (sarcastic.length === 1) {
							sarcastic[0].inferred = [new Card(suitIndex, rank)];
							logger.info(`writing ${logCard({suitIndex, rank})} from sarcastic discard`);
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
	if (state.level >= LEVEL.POSITIONAL_DISCARD && (playerIndex !== state.ourPlayerIndex) && !action.failed) {
		const discarded_card = card;
		const previous_hand = previousState.hands[playerIndex];
		const discarded_slot = previous_hand.indexOf(previous_hand.findOrder(discarded_card.order));
		logger.info(`discarded ${logCard(discarded_card)} from slot ${discarded_slot + 1}`);
		const knownTrash = previous_hand.filter(card => card.clued && card.possible.every(p => isBasicTrash(previousState, p.suitIndex, p.rank)));
		// Step 1: Find the correct card to discard.
		// TODO: Currently, the bot filters out any unclued kt. Should that be allowed to positional discard?
		let previousChopIndex;
		if (knownTrash.length > 0) {
			previousChopIndex = previous_hand.indexOf(knownTrash[0]);
			logger.info(`found known trash in slot ${previousChopIndex + 1} (${logCard(previous_hand[previousChopIndex])})`);
		} else {
			previousChopIndex = find_chop(previous_hand);
			logger.info(`no card found, using slot ${previousChopIndex + 1} as chop`);
		}
		// Step 2: Check that the player discarded a card that is different than expected.
		if ((previousChopIndex !== -1 ) && (previousChopIndex !== discarded_slot)) {
			// Step 3: Check everyone else's hand to see if they have a playable card in that slot.
			const possible = [];
			for (let search_player = 0; search_player < state.numPlayers; search_player++) {
				// Ignore our own hand and the giver's hand
				if ((search_player === state.ourPlayerIndex) || (search_player === playerIndex)) {
					continue;
				}
				const other_card = state.hands[search_player][discarded_slot];
				const playable_away = playableAway(state, other_card.suitIndex, other_card.rank);
				const hypo_away = other_card.rank - (state.hypo_stacks[other_card.suitIndex] + 1);

				if ((playable_away === 0) && (hypo_away === 0) && !other_card.finessed) {
					possible.push(search_player);
					logger.info(`found immediate playable ${logCard(other_card)} in ${state.playerNames[search_player]}'s hand`);
				}
			}
			// Step 4: Generate all immediate playables.
			const number_of_stacks = state.play_stacks.length;
			const all_playable = [];
			for (let stackIndex = 0; stackIndex < number_of_stacks; stackIndex++) {
				if (state.play_stacks[stackIndex] === state.hypo_stacks[stackIndex]) {
					all_playable.push({suitIndex: stackIndex, rank: state.play_stacks[stackIndex]+1});
				}
			}
			if (possible.length === 0) {
				// If no one has a playable, mark my card as the possible discarded.
				logger.warn(`could not find playable, assuming own hand`);
				const possible_card = state.hands[state.ourPlayerIndex][discarded_slot];

				possible_card.intersect('inferred', all_playable);
				possible_card.finessed = true;
				return;
			}
			// Step 5: Note down card(s) as playable.

			// Generates the order that people would play their cards from the discarders perspective
			const last_player_order = [];
			let temp = playerIndex;
			for (let i = 0; i < state.numPlayers; i++) {
				temp--;
				if (temp < 0) {
					temp = state.numPlayers - 1;
				}
				last_player_order.push(temp);
			}
			logger.info(`positional order is ${last_player_order.map(c => state.playerNames[c])}`);
			logger.info('ordering hands');
			const connections = [];
			let after_search = true;
			for (let other_index = 0; other_index < last_player_order.length; other_index++) {
				const search_index = last_player_order[other_index];
				if (search_index == state.ourPlayerIndex) {
					// Everyone after us does not have a playable
					logger.info('after search unsuccessful, assuming own hand or earlier');
					after_search = false;
					continue;
				}
				logger.debug(`searching ${state.playerNames[search_index]}`);
				if (possible.includes(search_index)) {
					logger.info(`found immediate playable in ${state.playerNames[search_index]}'s hand`);
					const possible_card = state.hands[search_index][discarded_slot];

					if (after_search) {
						// Someone after us has a playable, end search
						possible_card.intersect('inferred', all_playable);
						possible_card.finessed = true;
						logger.info(`playble card found after us, ending search`);
						return;
					} else {
						// Someone before us has a playable, we need to wait for them
						possible_card.old_inferred = Utils.objClone(possible_card.inferred);
						possible_card.intersect('inferred', all_playable);
						possible_card.finessed = true;
						const connection = {type: 'positional discard', reacting: search_index, card: possible_card};
						connections.push(connection);
					}
				}
			}
			if (connections.length > 0) {
				logger.warn('addding connection!');
				// Adds connections if there are any.
				connections.reverse();
				// @ts-ignore
				state.waiting_connections.push({ connections, focused_card: state.hands[state.ourPlayerIndex][discarded_slot], inference: { suitIndex: -2, rank: -2 } });
			} else {
				state.hands[state.ourPlayerIndex][discarded_slot].intersect('inferred', all_playable);
				state.hands[state.ourPlayerIndex][discarded_slot].finessed = true;
			}
			return;
		}
	}
}
