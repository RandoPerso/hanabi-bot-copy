// @ts-ignore
import { strict as assert } from 'node:assert';
// @ts-ignore
import { describe, it } from 'node:test';

import { COLOUR, PLAYER, setup } from '../../test-utils.js';
import HGroup from '../../../src/conventions/h-group.js';
import { CLUE } from '../../../src/constants.js';
import logger from '../../../src/tools/logger.js';

logger.setLevel(logger.LEVELS.ERROR);

describe('normal discards', () => {
	it('does not bomb from a chop discard', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r3', 'b4'],
			['g2', 'b3', 'r3', 'p2', 'p3']
		], 5);

		// Bob discards chop.
		state.handle_action({ type: 'discard', order: 5, playerIndex: PLAYER.BOB, suitIndex: COLOUR.BLUE, rank: 4, failed: false });
        state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.BLUE, rank: 5, playerIndex: PLAYER.BOB });

		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

        // Alice's slot 5 should not be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.ALICE][4].finessed, false);

        // Cathy also discards chop.
		state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 3, failed: false });
        state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.RED, rank: 5, playerIndex: PLAYER.CATHY });

		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 5 should still not be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.ALICE][4].finessed, false);

        // Alice discards chop.
        state.handle_action({ type: 'discard', order: 0, playerIndex: PLAYER.ALICE, suitIndex: COLOUR.GREEN, rank: 3, failed: false });
        state.handle_action({ type: 'draw', order: 17, suitIndex: -1, rank: -1, playerIndex: PLAYER.ALICE });
        state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.BOB });

        // Bob reverse finesses a p1 and a p2.
        state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.PURPLE }, giver: PLAYER.BOB, list: [11], target: PLAYER.CATHY });
        state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.CATHY });

        // Cathy discards chop.
        state.handle_action({ type: 'discard', order: 12, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 3, failed: false });
        state.handle_action({ type: 'draw', order: 18, suitIndex: COLOUR.YELLOW, rank: 5, playerIndex: PLAYER.CATHY });
        state.handle_action({ type: 'turn', num: 5, currentPlayerIndex: PLAYER.ALICE });

        // Alice's slot 4 should not be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.ALICE][3].finessed, false);
	});

	it('does not bomb from a basic clued kt discard', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['g4', 'r1', 'g4', 'r1', 'b4'],
			['g3', 'b3', 'r2', 'y3', 'p3'],
		], 5);

		// Alice clues Bob 1, touching slots 2 and 4.
		state.handle_action({ type: 'clue', clue: { type: CLUE.RANK, value: 1 }, giver: PLAYER.ALICE, list: [6, 8], target: PLAYER.BOB });

		// Bob plays slot 4 as r1.
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB });
		state.handle_action({ type: 'play', order: 6, suitIndex: COLOUR.RED, rank: 1, playerIndex: PLAYER.BOB });
        state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.BLUE, rank: 5, playerIndex: PLAYER.BOB });

        // Cathy clues Bob red, touching slot 3.
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.CATHY });
		state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.CATHY, list: [8], target: PLAYER.BOB });

        // Alice clues Cathy red, touching slot 3.
		state.handle_action({ type: 'turn', num: 3, currentPlayerIndex: PLAYER.ALICE });
        state.handle_action({ type: 'clue', clue: { type: CLUE.COLOUR, value: COLOUR.RED }, giver: PLAYER.ALICE, list: [12], target: PLAYER.CATHY });

        // Bob discards slot 3 (used to be slot 2) as r1.
        state.handle_action({ type: 'turn', num: 4, currentPlayerIndex: PLAYER.BOB });
        state.handle_action({ type: 'discard', order: 8, playerIndex: PLAYER.BOB, suitIndex: COLOUR.RED, rank: 1, failed: false});
        state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.RED, rank: 5, playerIndex: PLAYER.BOB });

        state.handle_action({ type: 'turn', num: 5, currentPlayerIndex: PLAYER.CATHY });

		// Alice's slot 3 should not be "finessed" by a positional discard.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, false);
	});

	it.skip('does not bomb from an inferred clued kt discard', () => {
	});

	it.skip('does not bomb from a chop discard with cm cards', () => {
	});

    it.skip('does not bomb from a sarcastic discard', () => {
	});

    it.skip('does not bomb from a bomb', () => {
	});
});

describe('positional discards', () => {
    it('plays from an obvious positional discard', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'r2', 'r3', 'b1'],
			['b1', 'b2', 'g1', 'g1', 'p1']
		], 5);

        state.play_stacks = [4, 4, 4, 4, 4];
        state.hypo_stacks = [4, 4, 4, 4, 4];

		// Bob discards slot 3.
		state.handle_action({ type: 'discard', order: 7, playerIndex: PLAYER.BOB, suitIndex: COLOUR.RED, rank: 2, failed: false });
        state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.BLUE, rank: 4, playerIndex: PLAYER.BOB });

        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });

		// Alice's slot 3 should be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, true);
	});

    it('does not play from a positional discard to someone after them', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'p5', 'r3', 'b1'],
			['b1', 'b2', 'g1', 'g1', 'p1']
		], 5);

        state.play_stacks = [4, 4, 4, 4, 4];
        state.hypo_stacks = [4, 4, 4, 4, 4];

		// Cathy discards slot 3.
		state.handle_action({ type: 'discard', order: 12, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.RED, rank: 2, failed: false });
        state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.BLUE, rank: 4, playerIndex: PLAYER.CATHY });

        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 3 should not be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, false);
        // Bob's slot 3 should be "finessed" from a positional discard.
        assert.equal(state.hands[PLAYER.BOB][2].finessed, true);
    });

    it('does not play from a positional discard if someone before them played into it', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'r2', 'r3', 'b1'],
			['b1', 'b2', 'p5', 'g1', 'p1']
		], 5);

        state.play_stacks = [4, 4, 4, 4, 4];
        state.hypo_stacks = [4, 4, 4, 4, 4];

		// Bob discards slot 3.
		state.handle_action({ type: 'discard', order: 7, playerIndex: PLAYER.BOB, suitIndex: COLOUR.RED, rank: 2, failed: false });
        state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.BLUE, rank: 4, playerIndex: PLAYER.BOB });

        // Cathy plays slot 3 as any 5.
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
		state.handle_action({ type: 'play', order: 12, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.PURPLE, rank: 5 });
        state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.GREEN, rank: 4, playerIndex: PLAYER.CATHY });

        state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 3 should not be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, false);
    });

    it('plays from a positional discard if someone before them did not play into it', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r1', 'r1', 'r2', 'r3', 'b1'],
			['b1', 'b2', 'p5', 'g1', 'p1']
		], 5);

        state.play_stacks = [4, 4, 4, 4, 4];
        state.hypo_stacks = [4, 4, 4, 4, 4];

		// Bob discards slot 3.
		state.handle_action({ type: 'discard', order: 7, playerIndex: PLAYER.BOB, suitIndex: COLOUR.RED, rank: 2, failed: false });
        state.handle_action({ type: 'draw', order: 15, suitIndex: COLOUR.BLUE, rank: 4, playerIndex: PLAYER.BOB });

        // Cathy discards slot 5 instead of playing slot 3.
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.CATHY });
		state.handle_action({ type: 'discard', order: 10, playerIndex: PLAYER.CATHY, suitIndex: COLOUR.BLUE, rank: 1, failed: false });
        state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.GREEN, rank: 4, playerIndex: PLAYER.CATHY });

        state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.ALICE });

		// Alice's slot 3 should be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.ALICE][2].finessed, true);
    });

    it('checks players after them in the right order', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
            ['r1', 'r1', 'b5', 'b1'],
            ['b1', 'b2', 'g5', 'g1'],
            ['g1', 'g3', 'r3', 'p4'],
		], 5);

        state.play_stacks = [4, 4, 4, 4, 4];
        state.hypo_stacks = [4, 4, 4, 4, 4];

		// Donald discards slot 3.
		state.handle_action({ type: 'discard', order: 13, playerIndex: PLAYER.DONALD, suitIndex: COLOUR.RED, rank: 3, failed: false });
        state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.BLUE, rank: 4, playerIndex: PLAYER.BOB });
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Cathy's slot 3 should be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.CATHY][2].finessed, true);
        // Bob's slot 3 should be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.BOB][2].finessed, false);
    });

    it('checks players before them in the right order', () => {
        const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx'],
            ['g1', 'g3', 'r3', 'p4'],
            ['r1', 'r1', 'b5', 'b1'],
            ['b1', 'b2', 'g5', 'g1'],
		], 5);

        state.play_stacks = [4, 4, 4, 4, 4];
        state.hypo_stacks = [4, 4, 4, 4, 4];

		// Donald discards slot 3.
		state.handle_action({ type: 'discard', order: 13, playerIndex: PLAYER.DONALD, suitIndex: COLOUR.RED, rank: 3, failed: false });
        state.handle_action({ type: 'draw', order: 16, suitIndex: COLOUR.BLUE, rank: 4, playerIndex: PLAYER.BOB });
        state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.ALICE });

		// Cathy's slot 3 should be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.CATHY][2].finessed, true);
        // Bob's slot 3 should not be "finessed" from a positional discard.
		assert.equal(state.hands[PLAYER.BOB][2].finessed, false);
    });
});

describe('mistake discards', () => {
	it('does not bomb from a useless positional discard', () => {
		const state = setup(HGroup, [
			['xx', 'xx', 'xx', 'xx', 'xx'],
			['r4', 'r4', 'g4', 'r3', 'b4'],
			['g2', 'b3', 'r5', 'p2', 'p3']
		], 5);

        state.play_stacks = [4, 5, 5, 5, 5];
        state.hypo_stacks = [4, 5, 5, 5, 5];

		// Alice clues Cathy red, touching slot 3.
		state.handle_action({ type: 'clue', clue: {type: CLUE.COLOUR, value: COLOUR.RED}, giver: PLAYER.ALICE, target: PLAYER.CATHY, list: [12]});
		state.handle_action({ type: 'turn', num: 1, currentPlayerIndex: PLAYER.BOB});

		// Bob discards slot 3.
		state.handle_action({ type: 'discard', order: 7, playerIndex: PLAYER.BOB, suitIndex: COLOUR.GREEN, rank: 4, failed: false});
		state.handle_action({ type: 'turn', num: 2, currentPlayerIndex: PLAYER.CATHY});

		// Alice should not attempt to play with no known playables.
		assert.equal(state.hands[PLAYER.ALICE][0].finessed, false);

	});
});
