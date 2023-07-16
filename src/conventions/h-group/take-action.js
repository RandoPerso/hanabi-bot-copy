import { ACTION } from '../../constants.js';
import { CLUE } from '../../constants.js';
import { LEVEL } from './h-constants.js';
import { select_play_clue, find_urgent_actions, determine_playable_card, order_1s } from './action-helper.js';
import { find_clues } from './clue-finder/clue-finder.js';
import { find_chop, inEndgame, minimum_clue_value } from './hanabi-logic.js';
import { getPace, isTrash, visibleFind, playableAway } from '../../basics/hanabi-util.js';
import logger from '../../tools/logger.js';
import { logCard, logClue, logHand, logPerformAction } from '../../tools/log.js';
import * as Utils from '../../tools/util.js';
import { card_value } from './clue-finder/clue-safe.js';

/**
 * @typedef {import('../h-group.js').default} State
 * @typedef {import('../../basics/Hand.js').Hand} Hand
 * @typedef {import('../../basics/Card.js').Card} Card
 * @typedef {import('../../types.js').PerformAction} PerformAction
 */

/**
 * Performs the most appropriate action given the current state.
 * @param {State} state
 * @return {PerformAction}
 */
export function take_action(state) {
	const { tableID } = state;
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues, stall_clues } = find_clues(state);

	// Look for playables, trash and important discards in own hand
	let playable_cards = hand.find_playables();
	let trash_cards = state.hands[state.ourPlayerIndex].find_known_trash().filter(c => c.clued);

	const discards = [];
	for (const card of playable_cards) {
		const id = card.identity({ infer: true });

		// Skip non-trash cards and cards we don't know the identity of
		if (!trash_cards.some(c => c.order === card.order) || id === undefined) {
			continue;
		}

		// If there isn't a matching playable card in our hand, we should discard it to sarcastic for someone else
		if (!playable_cards.some(c => c.matches(id.suitIndex, id.rank, { infer: true }) && c.order !== card.order)) {
			discards.push(card);
		}
	}

	// Remove trash cards from playables and discards from trash cards
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order));
	trash_cards = trash_cards.filter(tc => !discards.some(dc => dc.order === tc.order));

	if (playable_cards.length > 0) {
		logger.info('playable cards', logHand(playable_cards));
	}
	if (trash_cards.length > 0) {
		logger.info('trash cards', logHand(trash_cards));
	}
	if (discards.length > 0) {
		logger.info('discards', logHand(discards));
	}

	const playable_priorities = determine_playable_card(state, playable_cards);
	const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues, playable_priorities);

	if (urgent_actions.some(actions => actions.length > 0)) {
		logger.info('all urgent actions', urgent_actions.map((actions, index) => actions.map(action => { return { [index]: logPerformAction(action) }; })).flat());
	}

	let priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);

	/** @type {Card} */
	let best_playable_card;
	if (priority !== -1) {
		best_playable_card = playable_priorities[priority][0];

		// Best playable card is an unknown 1, so we should order correctly
		if (best_playable_card.clues.length > 0 && best_playable_card.clues.every(clue => clue.type === CLUE.RANK && clue.value === 1)) {
			const ordered_1s = order_1s(state, playable_cards);
			if (ordered_1s.length > 0) {
				let best_ocm_index = 0, best_ocm_value = -0.1;

				// Try to find a non-negative value OCM
				for (let i = 1; i < ordered_1s.length; i++) {
					const playerIndex = (state.ourPlayerIndex + i) % state.numPlayers;

					if (playerIndex === state.ourPlayerIndex) {
						break;
					}

					const old_chop_index = find_chop(state.hands[playerIndex]);
					// Player is locked, OCM is meaningless
					if (old_chop_index === -1) {
						continue;
					}
					const old_chop_value = card_value(state, state.hands[playerIndex][old_chop_index]);

					const newHand = state.hands[playerIndex].clone();
					newHand[old_chop_index].chop_moved = true;
					const new_chop_index = find_chop(newHand);

					// OCM to lock for unique 2 or criticals
					const new_chop_value = new_chop_index !== -1 ? card_value(state, newHand[new_chop_index]) : 3.5;

					const ocm_value = old_chop_value - new_chop_value;

					const { suitIndex, rank, order } = state.hands[playerIndex][old_chop_index];

					if (!isTrash(state, state.ourPlayerIndex, suitIndex, rank, order) && ocm_value > best_ocm_value) {
						best_ocm_index = i;
						best_ocm_value = ocm_value;
					}
				}
				best_playable_card = ordered_1s[best_ocm_index];
			}
		}

		if (state.level >= LEVEL.INTERMEDIATE_FINESSES) {
			while (priority === 0 && hand.some(c => c.finessed && c.finesse_index < best_playable_card.finesse_index)) {
				logger.warn('older finesse could be layered, unable to play newer finesse', logCard(best_playable_card));

				// Remove from playable cards
				playable_priorities[priority].splice(playable_priorities[priority].findIndex(c => c.order === best_playable_card.order), 1);
				playable_cards.splice(playable_cards.findIndex(c => c.order === best_playable_card.order), 1);

				// Find new best playable card
				priority = playable_priorities.findIndex(priority_cards => priority_cards.length > 0);
				if (priority !== -1) {
					best_playable_card = playable_priorities[priority][0];
				}
				else {
					best_playable_card = undefined;
				}
			}
		}

		if (priority !== -1) {
			logger.info(`best playable card is order ${best_playable_card.order}, inferences ${best_playable_card.inferred.map(c => logCard(c))}`);
		}
	}

	// Playing into finesse/bluff
	if (playable_cards.length > 0 && priority === 0) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	// Unlock next player
	if (urgent_actions[0].length > 0) {
		return urgent_actions[0][0];
	}

	// Urgent save for next player
	if (state.clue_tokens > 0) {
		for (let i = 1; i < 4; i++) {
			const actions = urgent_actions[i];
			if (actions.length > 0) {
				return actions[0];
			}
		}
	}

	// Get a high value play clue
	let best_play_clue, clue_value;
	if (state.clue_tokens > 0) {
		const all_play_clues = play_clues.flat();
		({ clue: best_play_clue, clue_value } = select_play_clue(all_play_clues));

		if (best_play_clue?.result.finesses > 0) {
			return Utils.clueToAction(best_play_clue, tableID);
		}
	}

	// Sarcastic discard to someone else
	if (state.level >= LEVEL.SARCASTIC && discards.length > 0) {
		const { suitIndex, rank } = discards[0].identity({ infer: true });
		const duplicates = visibleFind(state, state.ourPlayerIndex, suitIndex, rank, { ignore: [state.ourPlayerIndex] }).filter(c => c.clued);

		// If playing reveals duplicates are trash, playing is better for tempo in endgame
		if (inEndgame(state) && duplicates.every(c => c.inferred.length === 0 || (c.inferred.length === 1 && c.inferred[0].matches(suitIndex, rank)))) {
			return { tableID, type: ACTION.PLAY, target: discards[0].order };
		}

		return { tableID, type: ACTION.DISCARD, target: discards[0].order };
	}

	// Unlock other player than next
	if (urgent_actions[4].length > 0) {
		return urgent_actions[4][0];
	}

	// Forced discard if next player is locked
	// TODO: Anxiety play
	const nextPlayerIndex = (state.ourPlayerIndex + 1) % state.numPlayers;
	if (state.clue_tokens === 0 && state.hands[nextPlayerIndex].isLocked()) {
		discard_chop(hand, tableID);
	}

	// Playing a connecting card or playing a 5
	if (playable_cards.length > 0 && priority <= 3) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	// Discard known trash at high pace, low clues
	if (state.level < LEVEL.POSITIONAL_DISCARD && trash_cards.length > 0 && getPace(state) > state.numPlayers * 2 && state.clue_tokens <= 3) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards[0].order };
	}

	// Playable card with any priority
	if (playable_cards.length > 0) {
		return { tableID, type: ACTION.PLAY, target: best_playable_card.order };
	}

	if (state.clue_tokens > 0) {
		for (let i = 5; i < 9; i++) {
			// Give play clue (at correct priority level)
			if (i === (state.clue_tokens > 1 ? 5 : 8) && best_play_clue !== undefined) {
				if (clue_value >= minimum_clue_value(state)) {
					return Utils.clueToAction(best_play_clue, state.tableID);
				}
				else {
					logger.info('clue too low value', logClue(best_play_clue), clue_value);
					stall_clues[1].push(best_play_clue);
				}
			}

			// Go through rest of actions in order of priority (except early save)
			if (i !== 8 && urgent_actions[i].length > 0) {
				return urgent_actions[i][0];
			}
		}
	}

	// Either there are no clue tokens or the best play clue doesn't meet MCVP

	// All known trash and end game*, positional discard*
	if (state.level >= LEVEL.POSITIONAL_DISCARD && (trash_cards.length === hand.length) && inEndgame(state)) {
		// Find immediate playables that are not on the hypo stacks already
		const other_playables = [];
		let chopIndex = -1;
		for (let i = 0; i < hand.length; i++) {
			if (hand[i].clued === true) {
				chopIndex = i;
				logger.info(`found clued trash in slot ${i + 1}`);
			}
		}
		if (chopIndex === -1) {
			chopIndex = find_chop(hand);
			logger.info(`no clued trash found, using slot ${chopIndex + 1} as chop`);
		}
		// Generates the order that people would play their cards
		const last_player_order = [];
		let temp = state.ourPlayerIndex;
		for (let i = 0; i < state.numPlayers; i++) {
			temp--;
			if (temp < 0) {
				temp = state.numPlayers - 1;
			}
			last_player_order.push(temp);
		}
		logger.debug(`positional order is ${last_player_order.map(c => state.playerNames[c])}`);
		for (let target = 0; target < state.numPlayers; target++) {
			// Ignore our own hand
			if (target === state.ourPlayerIndex) {
				continue;
			}

			logger.info(`checking ${state.playerNames[target]}'s hand`);

			for (let cardIndex = 0; cardIndex < state.hands[target].length; cardIndex++) {
				// Identifies all playables that are not on our chop.
				if (cardIndex == chopIndex) {
					continue;
				}
				const card = state.hands[target][cardIndex];
				const { suitIndex, rank , clued, finessed} = card; // eslint-disable-line

				const playable_away = playableAway(state, suitIndex, rank);
				const hypo_away = rank - (state.hypo_stacks[suitIndex] + 1);

				if ((playable_away === 0) && (hypo_away === 0) && !finessed && !clued) {
					other_playables.push([cardIndex, target, last_player_order.indexOf(target)]);
					logger.info(`found playable ${logCard(card)} (order ${card.order}) in slot ${cardIndex + 1}`);
				}
			}
		}
		if (other_playables.length !== 0) {
			// TODO: Choose the card with the highest priority (or importance to be played)
			// Currently chooses a random card to discard for.
			const positional_playables = [];
			const accounted_slots = [];
			for (let i = 0; i < other_playables.length; i++) {
				// Identifies which cards would be played from each discard.
				const slot = other_playables[i][0];
				if (!accounted_slots.includes(slot)) {
					positional_playables.push(other_playables[i]);
					accounted_slots.push(slot);
				} else if (positional_playables[accounted_slots.indexOf(slot)][2] > other_playables[1][2]) {
					positional_playables.splice(accounted_slots.indexOf(slot), 1, other_playables[1]);
				}
			}
			// TODO: Allow the bot to correct which card was actually played in case of mistakes.
			const chosen_card = other_playables[Math.floor(Math.random() * other_playables.length)];
			const card_identity = state.hands[chosen_card[1]][chosen_card[0]];
			logger.info(`discarding for ${logCard(card_identity)} in ${state.playerNames[chosen_card[1]]}'s hand`);
			card_identity.finessed = true;
			// Give the positional discard
			return { tableID, type: ACTION.DISCARD, target: hand[chosen_card[0]].order };
		}
	}

	// Discard clued known trash (not stalling)
	if ((trash_cards.length > 0) && (trash_cards.some(c => c.clued)) && !inEndgame(state) && state.clue_tokens < 8) {
		return { tableID, type: ACTION.DISCARD, target: trash_cards.filter(c => c.clued)[0].order };
	}

	// Early save
	if (state.clue_tokens > 0 && urgent_actions[8].length > 0) {
		return urgent_actions[8][0];
	}

	const best_stall_severity = stall_clues.findIndex(clues => clues.length > 0);

	// Stalling situations
	if (state.clue_tokens > 0 && best_stall_severity !== -1) {
		const best_stall_clue = Utils.clueToAction(stall_clues[best_stall_severity][0], state.tableID);

		// 8 clues or locked hand
		if (state.clue_tokens === 8) {
			return best_stall_clue;
		}

		// Locked hand
		if (state.hands[state.ourPlayerIndex].isLocked()) {
			return best_stall_clue;
		}

		// Endgame (and stalling is effective)
		if (inEndgame(state) && state.hypo_stacks.some((stack, index) => stack > state.play_stacks[index])) {
			logger.info('endgame stall');
			return best_stall_clue;
		}

		// Early game
		if (state.early_game && best_stall_severity === 0) {
			return best_stall_clue;
		}
	}

	// Discard clued known trash
	if ((trash_cards.length > 0) && (trash_cards.some(c => c.clued))) {
		Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: trash_cards.filter(c => c.clued)[0].order });
		return;
	}

	return discard_chop(hand, tableID);
}

/**
 * Discards the card on chop from the hand.
 * @param {Hand} hand
 * @param {number} tableID
 */
function discard_chop(hand, tableID) {
	// Nothing else to do, so discard chop
	const chopIndex = find_chop(hand);
	const discard = (chopIndex !== -1) ? hand[chopIndex] : hand[Math.floor(Math.random() * hand.length)];

	return { tableID, type: ACTION.DISCARD, target: discard.order };
}
