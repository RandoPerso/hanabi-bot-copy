import { Hand } from './Hand.js';
import { isTrash } from './hanabi-util.js';

/**
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Player.js').Player} Player
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').Clue} Clue
 */

/**
 * @param  {Player} player
 * @param  {Player} hypo_player
 * @param  {Hand} hand
 * @param  {number[]} list
 */
export function elim_result(player, hypo_player, hand, list) {
	let new_touched = 0, fill = 0, elim = 0;

	for (const { order } of hand) {
		const old_card = player.thoughts[order];
		const hypo_card = hypo_player.thoughts[order];

		if (hypo_card.clued && !hypo_card.called_to_discard && hypo_card.possible.length < old_card.possible.length && hypo_card.matches_inferences()) {
			if (hypo_card.newly_clued && !hypo_card.finessed) {
				new_touched++;
			}
			else if (list.includes(order)) {
				fill++;
			}
			else {
				elim++;
			}
		}
	}
	return { new_touched, fill, elim };
}

/**
 * @param  {State} state
 * @param  {Player} hypo_player
 * @param  {Hand} hand
 * @param  {number} focus_order
 */
export function bad_touch_result(state, hypo_player, hand, focus_order) {
	let bad_touch = 0, trash = 0;

	for (const { order } of hand) {
		// Focused card can't be bad touched
		if (order === focus_order) {
			continue;
		}

		const hypo_card = hypo_player.thoughts[order];

		if (hypo_card.possible.every(p => isTrash(state, hypo_player, p, order))) {
			trash++;
		}
		// TODO: Don't double count bad touch when cluing two of the same card
		else if (isTrash(state, hypo_player, hypo_card.raw(), order)) {
			bad_touch++;
		}
	}

	return { bad_touch, trash };
}

/**
 * @param  {State} state
 * @param  {Player} player
 * @param  {Player} hypo_player
 * @param  {number} target
 */
export function playables_result(state, player, hypo_player, target) {
	let finesses = 0;
	const playables = [], safe_playables = [];

	/**
	 * TODO: This might not find the right card if it was duplicated...
	 * @param  {Identity} identity
	 */
	function find_card(identity) {
		for (let playerIndex = 0; playerIndex < state.numPlayers; playerIndex++) {
			const hand = state.hands[playerIndex];

			for (const { order } of hand) {
				const old_card = player.thoughts[order];
				const hypo_card = hypo_player.thoughts[order];

				if (hypo_card.saved && hypo_card.matches(identity, { infer: true })) {
					return { playerIndex, old_card, hypo_card };
				}
			}
		}
	}

	// Count the number of finesses and newly known playable cards
	for (let suitIndex = 0; suitIndex < state.suits.length; suitIndex++) {
		for (let rank = player.hypo_stacks[suitIndex] + 1; rank <= hypo_player.hypo_stacks[suitIndex]; rank++) {
			const { playerIndex, old_card, hypo_card } = find_card({ suitIndex, rank });

			if (hypo_card.finessed && !old_card.finessed) {
				finesses++;
			}

			// Only counts as a playable if it wasn't already playing
			if (!player.unknown_plays.some(order => order === old_card.order)) {
				playables.push({ playerIndex, card: old_card });

				if (hypo_player.thinksLoaded(state, target)) {
					safe_playables.push({ playerIndex, card: old_card });
				}
			}
		}
	}

	return { finesses, playables, safe_playables };
}
