import { CLUE } from '../../../constants.js';
import { cardTouched } from '../../../variants.js';
import { clue_safe } from './clue-safe.js';
import { find_fix_clues } from './fix-clues.js';
import { evaluate_clue, get_result } from './determine-clue.js';
import { determine_focus, valuable_tempo_clue } from '../hanabi-logic.js';
import { cardValue, isTrash, visibleFind } from '../../../basics/hanabi-util.js';
import { find_clue_value } from '../action-helper.js';

import logger from '../../../tools/logger.js';
import { logCard, logClue } from '../../../tools/log.js';
import * as Utils from '../../../tools/util.js';
import { LEVEL } from '../h-constants.js';

/**
 * @typedef {import('../../h-group.js').default} Game
 * @typedef {import('../../../types.js').Clue} Clue
 * @typedef {import('../../../types.js').SaveClue} SaveClue
 */

/**
 * Returns the value of a save clue, or -10 if it is not worth giving at all.
 * @param {Game} game
 * @param {Game} hypo_game
 * @param {SaveClue} save_clue
 * @param {Clue[]} all_clues
 */
function save_clue_value(game, hypo_game, save_clue, all_clues) {
	const { common, me, state } = game;
	const { target, result } = save_clue;
	const { chop_moved } = result;

	if (chop_moved.length === 0)
		return find_clue_value(result);

	// TODO: Should visible (but not saved, possibly on chop?) cards be included as trash?
	const saved_trash = chop_moved.filter(card =>
		isTrash(state, me, card, card.order, { infer: true }) ||			// Saving a trash card
		chop_moved.some(c => card.matches(c) && card.order > c.order)		// Saving 2 of the same card
	);

	// Direct clue is possible
	if (all_clues.some(clue => chop_moved.every(cm => saved_trash.some(c => c.order === cm.order) || cardTouched(cm, state.variant, clue))))
		return -10;

	const old_chop = common.chop(state.hands[target]);

	// Chop is trash, can give clue later
	if (isTrash(state, me, old_chop, old_chop.order, { infer: true }) || chop_moved.some(c => c.duplicateOf(old_chop)))
		return -10;

	// More trash cards saved than useful cards
	if (saved_trash.length > Math.min(1, chop_moved.length - saved_trash.length))
		return -10;

	const new_chop = hypo_game.common.chop(hypo_game.state.hands[target], { afterClue: true });

	// Target is not loaded and their new chop is more valuable than their old one
	if (!hypo_game.players[target].thinksLoaded(hypo_game.state, target) && (new_chop ? cardValue(state, me, new_chop) : 4) > cardValue(state, me, old_chop))
		return -10;

	return find_clue_value(result) - 0.1*saved_trash.length;
}

/**
 * Finds all play, save and fix clues for the given state.
 * Play and fix clues are 2D arrays as each player can potentially receive multiple play/fix clues.
 * Each player has only one save clue.
 * 
 * The 'ignorePlayerIndex' option skips finding clues for a particular player.
 * 
 * The 'ignoreCM' option prevents looking for save clues that cause chop moves.
 * @param {Game} game
 * @param {{ignorePlayerIndex?: number, ignoreCM?: boolean}} options
 */
export function find_clues(game, options = {}) {
	const { common, me, state } = game;

	logger.highlight('whiteb', '------- FINDING CLUES -------');

	const play_clues = /** @type Clue[][] */ 	([]);
	const save_clues = /** @type SaveClue[] */ 	([]);
	const stall_clues = /** @type Clue[][] */ 	([[], [], [], [], [], []]);

	logger.debug('play/hypo/max stacks in clue finder:', state.play_stacks, me.hypo_stacks, state.max_ranks);

	// Find all valid clues
	for (let target = 0; target < state.numPlayers; target++) {
		play_clues[target] = [];

		/** @type {(SaveClue & {game: Game})[]} */
		const saves = [];

		// Ignore our own hand
		if (target === state.ourPlayerIndex || target === options.ignorePlayerIndex)
			continue;

		const hand = state.hands[target];

		for (const clue of state.allValidClues(target)) {
			const touch = state.hands[target].clueTouched(clue, state.variant);

			const list = touch.map(c => c.order);
			const { focused_card, chop } = determine_focus(hand, common, list);

			const in_finesse = common.waiting_connections.some(w_conn => {
				const { focused_card: wc_focus, inference } = w_conn;
				const matches = me.thoughts[wc_focus.order].matches(inference, { assume: true });

				return matches && focused_card.playedBefore(inference, { equal: true });
			});

			// Do not focus cards that are part of a finesse
			if (me.thoughts[focused_card.order].finessed || in_finesse)
				continue;

			const bad_touch_cards = touch.filter(c => !c.clued && isTrash(state, game.me, game.me.thoughts[c.order].identity({ infer: true }), c.order));		// Ignore cards that were already clued

			// Simulate clue from receiver's POV to see if they have the right interpretation
			const action =  /** @type {const} */ ({ type: 'clue', giver: state.ourPlayerIndex, target, list, clue });
			const hypo_game = evaluate_clue(game, action, clue, target, focused_card, bad_touch_cards);

			// Clue had incorrect interpretation
			if (hypo_game === undefined)
				continue;

			const interpret = hypo_game.common.thoughts[focused_card.order].inferred;
			const result = get_result(game, hypo_game, clue, state.ourPlayerIndex);
			Object.assign(clue, { result });

			const safe = clue_safe(game, me, clue);

			const { elim, new_touched, bad_touch, trash, avoidable_dupe, finesses, playables, chop_moved } = result;
			const remainder = (chop && (!safe || state.clue_tokens <= 2)) ? result.remainder: 0;

			const result_log = {
				clue: logClue(clue),
				bad_touch,
				trash,
				avoidable_dupe,
				interpret: interpret?.map(logCard),
				elim,
				new_touched: new_touched.length,
				finesses: finesses.length,
				playables: playables.map(({ playerIndex, card }) => `${logCard(state.deck[card.order])} (${state.playerNames[playerIndex]})`),
				chop_moved: chop_moved.map(c => `${logCard(state.deck[c.order])} ${c.order}`),
				remainder	// We only need to check remainder if this clue focuses chop, because we are changing chop to something else
			};
			logger.info('result,', JSON.stringify(result_log), find_clue_value(Object.assign(result, { remainder })));

			if ((chop && !state.isBasicTrash(focused_card) && visibleFind(state, me, focused_card).length === 1) || chop_moved.length > 0) {
				if (game.level < LEVEL.CONTEXT || clue.result.avoidable_dupe == 0)
					saves.push(Object.assign(clue, { game: hypo_game, playable: playables.length > 0, cm: chop_moved, safe }));
				else
					logger.highlight('yellow', `${logClue(clue)} save results in avoidable potential duplication`);
			}

			const focus_known_bluff = hypo_game.common.waiting_connections.some(c => {
				return c.connections[0].bluff && c.focused_card.order == focused_card.order;
			});
			// Clues where the focus isn't playable but may be assumed playable or that cause chop moves aren't plays/stalls
			if ((playables.length > 0 && !playables.some(({ card }) => card.order === focused_card.order) && !focus_known_bluff) ||
				(playables.length === 0 && chop_moved.length > 0) ||
				isTrash(state, me, focused_card, focused_card.order)) {
				logger.highlight('yellow', 'invalid play clue');
				continue;
			}

			if (playables.length > 0) {
				if (safe) {
					const { tempo, valuable } = valuable_tempo_clue(game, clue, playables, focused_card);
					if (tempo && !valuable)
						stall_clues[1].push(clue);
					else if (game.level < LEVEL.CONTEXT || clue.result.avoidable_dupe == 0)
						play_clues[target].push(clue);
					else
						logger.highlight('yellow', `${logClue(clue)} results in avoidable potential duplication`);
				}
				else {
					logger.highlight('yellow', `${logClue(clue)} is an unsafe play clue`);
				}
			}
			// Stall clues
			else {
				if (clue.type === CLUE.RANK && clue.value === 5 && !focused_card.clued) {
					logger.info('5 stall', logClue(clue));
					stall_clues[0].push(clue);
				}
				else if (me.thinksLocked(state, state.ourPlayerIndex) && chop) {
					logger.info('locked hand save', logClue(clue));
					stall_clues[3].push(clue);
				}
				else if (new_touched.length === 0) {
					if (elim > 0) {
						logger.info('fill in', logClue(clue));
						stall_clues[2].push(clue);
					}
					else {
						logger.info('hard burn', logClue(clue));
						stall_clues[5].push(clue);
					}
				}
				else {
					if (chop && focused_card.rank === 2) {
						const copies = visibleFind(state, me, focused_card);
						const chops = state.hands.map(hand => common.chop(hand)?.order);

						if (copies.some(c => chops.includes(c.order))) {
							logger.warn('illegal 2 save');
							continue;
						}
					}

					logger.highlight('yellow', 'unknown valid clue??', logClue(clue));
				}
			}
		}

		const all_clues = [...saves, ...play_clues[target]];
		save_clues[target] = Utils.maxOn(saves, (save_clue) => save_clue_value(game, save_clue.game, save_clue, all_clues), 0);
	}

	const fix_clues = find_fix_clues(game, play_clues, save_clues, options);

	if (play_clues.some(clues => clues.length > 0))
		logger.info('found play clues', play_clues.flatMap(clues => clues.map(clue => logClue(clue))));

	if (save_clues.some(clue => clue !== undefined))
		logger.info('found save clues', save_clues.filter(clue => clue !== undefined).map(clue => logClue(clue)));

	if (fix_clues.some(clues => clues.length > 0))
		logger.info('found fix clues', fix_clues.flatMap(clues => clues.map(clue => logClue(clue) + (clue.trash ? ' (trash)' : ''))));

	if (stall_clues.some(clues => clues.length > 0))
		logger.info('found stall clues', stall_clues.flatMap(clues => clues.map(clue => logClue(clue))));

	return { play_clues, save_clues, fix_clues, stall_clues };
}
