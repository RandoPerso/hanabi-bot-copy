const { ACTION } = require('../../constants.js');
const { select_play_clue, find_urgent_actions, determine_playable_card } = require('./action-helper.js');
const { find_clues } = require('./clue-finder/clue-finder.js');
const { find_stall_clue } = require('./clue-finder/stall-clues.js');
const { find_chop, inEndgame } = require('./hanabi-logic.js');
const { find_playables, find_known_trash } = require('../../basics/helper.js');
const { logger } = require('../../logger.js');
const Utils = require('../../util.js');

function take_action(state) {
	const { tableID } = state;
	const hand = state.hands[state.ourPlayerIndex];
	const { play_clues, save_clues, fix_clues } = find_clues(state);
	const urgent_actions = find_urgent_actions(state, play_clues, save_clues, fix_clues);

	logger.info('all urgent actions', urgent_actions);

	// Unlock next player
	if (urgent_actions[0].length > 0) {
		Utils.sendCmd('action', urgent_actions[0][0]);
		return;
	}

	// Urgent save for next player
	if (state.clue_tokens > 0) {
		for (let i = 1; i < 4; i++) {
			const actions = urgent_actions[i];
			if (actions.length > 0) {
				Utils.sendCmd('action', actions[0]);
				return;
			}
		}
	}

	// Then, look for playables or trash in own hand
	let playable_cards = find_playables(state.play_stacks, hand);
	const trash_cards = find_known_trash(state, state.ourPlayerIndex);

	// Remove sarcastic discards from playables
	playable_cards = playable_cards.filter(pc => !trash_cards.some(tc => tc.order === pc.order));
	logger.debug('playable cards', Utils.logHand(playable_cards));
	logger.info('trash cards', Utils.logHand(trash_cards));

	// No saves needed, so play
	if (playable_cards.length > 0) {
		const card = determine_playable_card(state, playable_cards);
		Utils.sendCmd('action', { tableID, type: ACTION.PLAY, target: card.order });
		return;
	}

	// Unlock other player than next
	if (urgent_actions[4].length > 0) {
		Utils.sendCmd('action', urgent_actions[4][0]);
		return;
	}

	let tempo_clue;
	if (state.clue_tokens > 0) {
		for (let i = 5; i < 9; i++) {
			// Give play clue (at correct priority level)
			if (i === (state.clue_tokens > 1 ? 5 : 8)) {
				let all_play_clues = play_clues.flat();
				const { clue, clue_value } = select_play_clue(all_play_clues);

				// -0.5 if 2 players (allows tempo clues to be given)
				// -10 if endgame
				const minimum_clue_value = 1 - (state.numPlayers === 2 ? 0.5 : 0) - (inEndgame(state) ? 10 : 0);

				if (clue_value >= minimum_clue_value) {
					const { type, target, value } = clue;
					Utils.sendCmd('action', { tableID, type, target, value });
					return;
				}
				else {
					logger.info('clue too low value', Utils.logClue(clue), clue_value);
					tempo_clue = clue;
				}
			}

			// Go through rest of actions in order of priority (except early save)
			if (i !== 8 && urgent_actions[i].length > 0) {
				Utils.sendCmd('action', urgent_actions[i][0]);
				return;
			}
		}
	}

	// Either there are no clue tokens or the best play clue doesn't meet MCVP

	// 8 clues
	if (state.clue_tokens === 8) {
		const { type, value, target } = find_stall_clue(state, 4, tempo_clue);

		// Should always be able to find a clue, even if it's a hard burn
		Utils.sendCmd('action', { tableID, type, target, value });
		return;
	}
		
		// All known trash and end game*, positional discard*
		// TODO: Add logging
		if ((trash_cards.length === hand.length) && (state.cards_left < 5)) {
			// Find immediate playables that are not on the hypo stacks already
			let other_playables = [];
			// TODO: Make the loop find a more "correct" chop when all trash since clued trash has higher discard priority than unclued trash
			const chopIndex = find_chop(hand);
			for (let target = 0; target < state.numPlayers; target++) {
				// Ignore our own hand
				if (target === state.ourPlayerIndex) {
					continue;
				}

				for (let cardIndex = 0; cardIndex < state.hands[target].length; cardIndex++) {
					if (cardIndex == chopIndex) {
						continue;
					}
					const card = state.hands[target][cardIndex];
					const { suitIndex, rank , clued, finessed} = card;
					
					let playable_away = Utils.playableAway(state, suitIndex, rank);
					let hypo_away = rank - (state.hypo_stacks[suitIndex] + 1);

					if ((playable_away === 0) && (hypo_away === 0) && !clued && !finessed) {
						other_playables.push(cardIndex);
					}
				}
			}
			if (other_playables.length !== 0) {
				// TODO: Choose the card with the highest priority (or importance to be played)
				// Currently chooses a random card to discard for.
				let chosen_card_position = other_playables[Math.floor(Math.random() * other_playables.length)];
				// Give the positional discard
				Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: hand[chosen_card_position].order });
				return;	
			}
		}
		
	// Discard known trash if hand is not all known trash
	if ((trash_cards.length > 0) && (trash_cards.length !== hand.length)) {
		Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: trash_cards[0].order });
		return;
	}

	// Early save
	if (state.clue_tokens > 0 && urgent_actions[8].length > 0) {
		Utils.sendCmd('action', urgent_actions[8][0]);
		return;
	}

	// Locked hand and no good clues to give
	if (state.hands[state.ourPlayerIndex].isLocked() && state.clue_tokens > 0) {
		const { type, value, target } = find_stall_clue(state, 3, tempo_clue);
		Utils.sendCmd('action', { tableID, type, target, value });
		return;
	}

	// Early game
	if (state.early_game && state.clue_tokens > 0) {
		const clue = find_stall_clue(state, 1, tempo_clue);

		if (clue !== undefined) {
			const { type, value, target } = clue;
			Utils.sendCmd('action', { tableID, type, target, value });
			return;
		}
	}

	// Endgame
	if (inEndgame(state) && state.clue_tokens > 0) {
		// If there are playables left in other hands (act like 8 clue stall)
		if (state.hypo_stacks.some((stack, index) => stack > state.play_stacks[index])) {
			const clue = find_stall_clue(state, 4, tempo_clue);

			if (clue !== undefined) {
				const { type, value, target } = clue;
				Utils.sendCmd('action', { tableID, type, target, value });
				return;
			}
		}
	}

	// Nothing else to do, so discard chop
	const chopIndex = find_chop(hand);
	logger.debug('discarding chop index', chopIndex);
	let discard;

	if (chopIndex !== -1) {
		discard = hand[chopIndex];
	}
	else {
		discard = hand[Math.floor(Math.random() * hand.length)];
	}

	Utils.sendCmd('action', { tableID, type: ACTION.DISCARD, target: discard.order });
}

module.exports = { take_action };
