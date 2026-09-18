import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';

test('local proxy rejects cross-site requests, secret paths, and invalid games', async t => {
  let calls = 0;
  const app = createApp({ apiKey: 'test-key', decide: async game => { calls++; return { choice: game.legal[0].id }; }, requestBudget: 2 });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}`;
  const post = (body, headers = {}) => fetch(`${url}/api/move`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url, ...headers }, body: JSON.stringify(body) });
  const input = { game: 'chess', scenario: 'opening', moves: [] };
  assert.equal((await fetch(`${url}/api/status`)).status, 200);
  assert.equal((await fetch(`${url}/.env`)).status, 404);
  assert.equal((await fetch(`${url}/server.mjs`)).status, 404);
  const badHostStatus = await new Promise((resolve, reject) => {
    http.get(`${url}/`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await post(input, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(input, { Origin: '' })).status, 403);
  assert.equal((await post(input, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ ...input, moves: ['e2e5'] })).status, 400);
  assert.equal((await post({ ...input, padding: 'x'.repeat(33000) })).status, 413);
  assert.equal((await post(input)).status, 200);
  assert.equal((await post(input)).status, 200);
  assert.equal((await post(input)).status, 429);
  assert.equal(calls, 2);
});

test('only one upstream decision may run at a time', async t => {
  let release, started;
  const hasStarted = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const app = createApp({ apiKey: 'test-key', decide: async () => { started(); await pending; return { choice: 'e2e4' }; } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}`;
  const request = () => fetch(`${url}/api/move`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ game: 'chess', scenario: 'opening', moves: [] }) });
  const first = request(); await hasStarted;
  try { assert.equal((await request()).status, 429); }
  finally { release(); }
  assert.equal((await first).status, 200);
});
