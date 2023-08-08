import { describe, it } from 'node:test';

import { PLAYER, setup, expandShortCard, takeTurn } from '../../test-utils.js';
import * as ExAsserts from '../../extra-asserts.js';
import HGroup from '../../../src/conventions/h-group.js';

import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('play clue', () => {
	it('can interpret a colour play clue touching one card', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r1', 'b5', 'p2', 'y1']
		], { level: 1 });

		takeTurn(state, 'Alice clues red to Bob');

		// Target card should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][1];
		ExAsserts.cardHasInferences(targetCard, ['r1']);
	});

	it('can interpret a colour play clue touching multiple cards', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r4', 'r3', 'p2', 'y1']
		], { level: 1 });

		takeTurn(state, 'Alice clues red to Bob');

		// Bob's slot 1 should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][0];
		ExAsserts.cardHasInferences(targetCard, ['r1']);
	});

	it('can interpret a colour play clue touching chop', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r3', 'r4', 'p2', 'b5', 'r1']
		], { level: 1 });

		takeTurn(state, 'Alice clues red to Bob');

		// Bob's slot 5 (chop) should be inferred as r1.
		const targetCard = state.hands[PLAYER.BOB][4];
		ExAsserts.cardHasInferences(targetCard, ['r1']);
	});

	it('can interpret a colour play clue on a partial stack', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p2', 'b5', 'r3', 'y4', 'y3']
		], {
			level: 1,
			play_stacks: [2, 0, 0, 0, 0]
		});

		takeTurn(state, 'Alice clues red to Bob');

		// Bob's slot 3 should be inferred as r3.
		const targetCard = state.hands[PLAYER.BOB][2];
		ExAsserts.cardHasInferences(targetCard, ['r3']);
	});

	it('can interpret a colour play clue through someone\'s hand', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p2', 'b5', 'r2', 'y4', 'y3'],
			['g1', 'r1', 'g4', 'y2', 'b2']
		], { level: 1 });

		// Cathy's r1 is clued and inferred.
		state.hands[PLAYER.CATHY][1].clued = true;
		state.hands[PLAYER.CATHY][1].intersect('possible', ['r1', 'r2', 'r3', 'r4', 'r5'].map(expandShortCard));
		state.hands[PLAYER.CATHY][1].intersect('inferred', ['r1'].map(expandShortCard));

		takeTurn(state, 'Alice clues red to Bob');

		// Bob's slot 3 should be inferred as r2.
		const targetCard = state.hands[PLAYER.BOB][2];
		ExAsserts.cardHasInferences(targetCard, ['r2']);
	});

	it('can interpret a self-connecting colour play clue', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r2', 'r1', 'b2', 'p5', 'y4'],
		], { level: 1 });

		// Bob has a 1 in slot 2.
		state.hands[PLAYER.BOB][1].clued = true;
		state.hands[PLAYER.BOB][1].intersect('possible', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));
		state.hands[PLAYER.BOB][1].intersect('inferred', ['r1', 'y1', 'g1', 'b1', 'p1'].map(expandShortCard));

		takeTurn(state, 'Alice clues red to Bob');

		// Bob's slot 1 should be inferred as r2.
		const targetCard = state.hands[PLAYER.BOB][0];
		ExAsserts.cardHasInferences(targetCard, ['r2']);
	});
});
