import { describe, it } from 'node:test';

import { take_action } from '../../src/conventions/playful-sieve/take-action.js';
import { ACTION } from '../../src/constants.js';
import { PLAYER, setup, takeTurn } from '../test-utils.js';
import * as ExAsserts from '../extra-asserts.js';
import PlayfulSieve from '../../src/conventions/playful-sieve.js';

import logger from '../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('fix clues', () => {
	it('gives a fix clue after playing a duplicated card', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['b1', 'p4', 'r5', 'r3', 'g3']
		], {
			starting: PLAYER.BOB
		});

		takeTurn(state, 'Bob clues purple to Alice (slot 1)');
		takeTurn(state, 'Alice plays b1 (slot 2)');
		takeTurn(state, 'Bob clues 5 to Alice (slot 1)');

		// Alice should give 1 or blue to Bob to fix.
		ExAsserts.objHasProperties(take_action(state), { type: ACTION.RANK, value: 1 });
	});

	it('understands a fix clue after playing a duplicated card', () => {
		const state = setup(PlayfulSieve, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['p4', 'b1', 'r5', 'r3', 'g3']
		]);

		takeTurn(state, 'Alice clues purple to Bob (slot 1)');
		takeTurn(state, 'Bob plays b1', 'y5');
		takeTurn(state, 'Alice clues 5 to Bob');
		takeTurn(state, 'Bob clues 1 to Alice (slot 1)');

		// Slot 1 is exactly b1.
		ExAsserts.cardHasInferences(state.common.thoughts[state.hands[PLAYER.ALICE][0].order], ['b1']);
	});
});