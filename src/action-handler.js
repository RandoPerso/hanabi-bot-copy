import * as Basics from './basics.js';
import logger from './tools/logger.js';
import { logAction, logCard, logPerformAction } from './tools/log.js';
import * as Utils from './tools/util.js';

/**
 * @typedef {import('./types.js').Action} Action
 * @typedef {import('./types.js').ClueAction} ClueAction
 * @typedef {import('./types.js').DiscardAction} DiscardAction
 * @typedef {import('./types.js').CardAction} CardAction
 * @typedef {import('./types.js').PlayAction} PlayAction
 * @typedef {import('./basics/State.js').State} State
 */

/**
 * @this State
 * @param {Action} 	action
 * @param {boolean} [catchup]	Whether the bot should take an action or not as a result of this action.
 * */
export function handle_action(action, catchup = false) {
	this.actionList.push(action);

	switch(action.type) {
		case 'clue': {
			// {type: 'clue', clue: { type: 1, value: 1 }, giver: 0, list: [ 8, 9 ], target: 1, turn: 0}
			const { giver, target, list } = action;
			logger.highlight('yellowb', `Turn ${this.turn_count}: ${logAction(action)}`);

			this.interpret_clue(this, action);
			this.last_actions[giver] = action;

			// Remove the newly_clued flag
			for (const order of list) {
				const card = this.hands[target].findOrder(order);
				card.newly_clued = false;
			}

			// Clear the list of ignored cards
			this.next_ignore = [];
			break;
		}
		case 'discard': {
			// {type: 'discard', playerIndex: 2, order: 12, suitIndex: 0, rank: 3, failed: true}
			const { order, playerIndex, rank, suitIndex } = action;
			const card = this.hands[playerIndex].findOrder(order);

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			logger.highlight('yellowb', `Turn ${this.turn_count}: ${logAction(action)}`);

			this.interpret_discard(this, action, card);
			this.last_actions[playerIndex] = Object.assign(action, { card });
			break;
		}
		case 'draw': {
			// { type: 'draw', playerIndex: 0, order: 2, suitIndex: 1, rank: 2 },
			Basics.onDraw(this, action);
			break;
		}
		case 'gameOver': {
			logger.highlight('redb', logAction(action));
			this.in_progress = false;
			break;
		}
		case 'turn': {
			//  { type: 'turn', num: 1, currentPlayerIndex: 1 }
			const { currentPlayerIndex, num } = action;
			this.turn_count = num + 1;

			if (currentPlayerIndex === this.ourPlayerIndex && !catchup) {
				if (this.in_progress) {
					setTimeout(() => Utils.sendCmd('action', this.take_action(this)), 2000);
				}
				// Replaying a turn
				else {
					const suggested_action = this.take_action(this);
					logger.highlight('cyan', 'Suggested action:', logPerformAction(suggested_action));
				}
			}

			// Update notes on cards
			for (const card of this.hands[this.ourPlayerIndex]) {
				if (card.clued || card.finessed || card.chop_moved) {
					const note = card.getNote();

					if (this.notes[card.order] === undefined) {
						this.notes[card.order] = { last: '', turn: 0, full: '' };
					}

					// Only write a new note if it's different from the last note and is a later turn
					if (note !== this.notes[card.order].last && this.turn_count > this.notes[card.order].turn) {
						this.notes[card.order].last = note;
						this.notes[card.order].turn = this.turn_count;

						if (this.notes[card.order].full !== '') {
							this.notes[card.order].full += ' | ';
						}
						this.notes[card.order].full += `t${this.turn_count}: ${note}`;

						if (this.in_progress) {
							setTimeout(() => Utils.sendCmd('note', { tableID: this.tableID, order: card.order, note: this.notes[card.order].full }), Math.random() * 1000);
						}
					}
				}
			}

			this.update_turn(this, action);
			break;
		}
		case 'play': {
			const { order, playerIndex, rank, suitIndex } = action;
			const card = this.hands[playerIndex].findOrder(order);

			// Assign the card's identity if it isn't already known
			Object.assign(card, {suitIndex, rank});
			logger.highlight('yellowb', `Turn ${this.turn_count}: ${logAction(action)}`);

			this.interpret_play(this, action);
			this.last_actions[playerIndex] = Object.assign(action, { card });
			break;
		}
		case 'identify': {
			const { order, playerIndex, suitIndex, rank } = action;

			const card = this.hands[playerIndex].findOrder(order);
			if (card === undefined) {
				throw new Error('Could not find card to rewrite!');
			}
			logger.info(`identifying card with order ${order} as ${logCard({ suitIndex, rank })}`);
			Object.assign(card, { suitIndex, rank });
			card.rewinded = true;
			break;
		}
		case 'ignore': {
			const { order, playerIndex } = action;

			const card = this.hands[playerIndex].findOrder(order);
			if (card === undefined) {
				throw new Error('Could not find card to ignore!');
			}

			this.next_ignore.push(card.order);
			break;
		}
		default:
			break;
	}
}
