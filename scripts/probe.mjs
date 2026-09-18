import { writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';
import { createGame, SCENARIOS } from '../public/game.js';
import { askJev, decisionRequest, MODEL } from '../lib/jev.mjs';

if (!process.env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY before running the probes.');
const results = [];
for (const kind of ['chess', 'connect']) {
  for (const scenario of SCENARIOS[kind]) {
    for (const order of ['normal', 'reversed']) {
      const input = { game: kind, scenario: scenario.id, moves: [] };
      const game = createGame(input, Chess);
      if (order === 'reversed') game.legal.reverse();
      const request = decisionRequest(game);
      try {
        const result = await askJev(game, { apiKey: process.env.OPENROUTER_API_KEY });
        const after = createGame({ ...input, moves: [result.choice] }, Chess);
        const expected = { 'fools-mate': 'd8h4', 'back-rank': 'e1e8', 'win-now': '4', 'block-now': '4' }[scenario.id] ?? null;
        const item = { game: kind, scenario: scenario.id, order, expected, passed: expected === null ? null : result.choice === expected, request, result, outcome: after.outcome };
        results.push(item);
        console.log(JSON.stringify({ game: kind, scenario: scenario.id, order, choice: result.choice, label: result.label, expected, passed: item.passed, latencyMs: result.latencyMs, confidence: result.confidence }));
      } catch (error) {
        results.push({ game: kind, scenario: scenario.id, order, error: error.message });
        console.log(JSON.stringify({ game: kind, scenario: scenario.id, order, error: error.message }));
      }
    }
  }
}
const successful = results.filter(r => r.result);
const times = successful.map(r => r.result.latencyMs).sort((a, b) => a - b);
const measured = results.filter(r => r.expected);
const summary = { attempts: results.length, successful: successful.length, tacticalChecks: measured.length, tacticalCorrect: measured.filter(r => r.passed).length, medianMs: times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null, totalReportedCost: successful.reduce((a, r) => a + (r.result.usage.cost || 0), 0) };
await writeFile(new URL('../research/probes.json', import.meta.url), JSON.stringify({ date: new Date().toISOString(), model: MODEL, note: 'Small exploratory sample. No strength or Elo claim. All calls use the UI action contract; option order is reversed for the second call.', summary, results }, null, 2));
console.log(JSON.stringify(summary));
