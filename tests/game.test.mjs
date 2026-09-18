import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { createGame } from '../public/game.js';
import { decisionRequest, validateAnswer, askJev } from '../lib/jev.mjs';

const game = (moves = [], scenario = 'opening', kind = 'chess') => createGame({ game: kind, scenario, moves }, Chess);

test('opening and replay enforce legal chess moves', () => {
  assert.equal(game().legal.length, 20);
  assert.equal(game(['e2e4']).turn, 'Black');
  assert.throws(() => game(['e2e5']));
  assert.throws(() => game(['e7e5']));
  assert.throws(() => game([], 'arbitrary'));
});
test('checkmate ends the game and cannot be followed by another action', () => {
  assert.deepEqual(game(['d8h4'], 'fools-mate').outcome, { winner: 'Black', reason: 'Checkmate' });
  assert.deepEqual(game(['e1e8'], 'back-rank').outcome, { winner: 'White', reason: 'Checkmate' });
  assert.throws(() => game(['d8h4', 'a2a3'], 'fools-mate'));
});
test('criteria disclose moves without engine mate or check labels', () => {
  const request = decisionRequest(game([], 'fools-mate'));
  assert.equal(request.questions.move.criteria.d8h4, 'Move black queen from d8 to h4.');
  assert.doesNotMatch(JSON.stringify(request.questions.move.criteria), /mate|#["\s]|\+/);
  assert.equal(request.state.pieces.black.includes('queen on d8'), true);
});
test('move history preserves castling, en passant, and repetition', () => {
  const castled = game(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1']);
  assert.equal(castled.board[7][6].type, 'k');
  assert.equal(castled.board[7][5].type, 'r');
  const ep = game(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
  assert.equal(ep.board[2][3].type, 'p');
  assert.equal(ep.board[3][3], null);
  assert.equal(game(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']).outcome.reason, 'Threefold repetition');
});
test('promotion choices include all four pieces and validate the selected piece', () => {
  const moves = ['a2a4','h7h5','a4a5','h5h4','a5a6','h4h3','a6b7','h3g2'];
  const options = game(moves).legal.filter(m => m.from === 'b7' && m.to === 'a8');
  assert.deepEqual(options.map(m => m.promotion).sort(), ['b','n','q','r']);
  assert.equal(game([...moves, 'b7a8n']).board[0][0].type, 'n');
  assert.throws(() => game([...moves, 'b7a8k']));
});
test('Connect Four drops to the lowest cell and stops at wins', () => {
  assert.equal(game(['4'], 'opening', 'connect').board[5][3], 'Red');
  const win = game(['4'], 'win-now', 'connect');
  assert.equal(win.outcome.winner, 'Red');
  assert.equal(win.outcome.cells.length, 4);
  assert.throws(() => game(['4', '2'], 'win-now', 'connect'));
  assert.throws(() => game(['0'], 'opening', 'connect'));
  assert.throws(() => game(['1','1','1','1','1','1','1'], 'opening', 'connect'));
  assert.equal(game(['1','1','1','1','1','1'], 'opening', 'connect').legal.some(m => m.id === '1'), false);
});
test('Connect Four finds vertical and both diagonal wins', () => {
  for (const moves of [
    ['1','2','1','2','1','3','1'],
    ['1','2','2','3','4','3','3','4','5','4','4'],
    ['7','6','6','5','4','5','5','4','3','4','4'],
  ]) assert.equal(game(moves, 'opening', 'connect').outcome.winner, 'Red');
});
test('untrusted answers cannot execute unknown actions or display bad probabilities', () => {
  const g = game();
  const data = { answers: { move: { type: 'choice', choice: 'e2e4', confidence: .8, probabilities: Object.fromEntries(g.legal.map(m => [m.id, m.id === 'e2e4' ? 1 : 0])) } }, usage: { input_tokens: 1, cost: .001 } };
  assert.equal(validateAnswer(data, g).choice, 'e2e4');
  for (const choice of ['e2e5', '__proto__', '<script>alert(1)</script>']) assert.throws(() => validateAnswer({ ...data, answers: { move: { ...data.answers.move, choice } } }, g));
  for (const confidence of [NaN, Infinity, -1, 2, '0.8']) assert.throws(() => validateAnswer({ ...data, answers: { move: { ...data.answers.move, confidence } } }, g));
  assert.throws(() => validateAnswer({ ...data, answers: { move: { ...data.answers.move, probabilities: { e2e4: 1 } } } }, g));
});
test('provider failures do not disclose their bodies', async () => {
  await assert.rejects(askJev(game(), { apiKey: 'test', fetchImpl: async () => new Response('private upstream detail', { status: 500 }) }), /OpenRouter returned an error \(500\)/);
  await assert.rejects(askJev(game(), { apiKey: 'test', fetchImpl: async () => new Response('x'.repeat(140000)) }), /unreadable response/);
  await assert.rejects(askJev(game(), {}), /Set OPENROUTER_API_KEY/);
});
