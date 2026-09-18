import { Chess } from '/vendor/chess.js';
import { createGame, SCENARIOS, PIECE_NAMES, MAX_MOVES } from './game.js';

const $ = id => document.getElementById(id);
const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const state = { game: 'chess', scenario: 'opening', moves: [], mode: 'human' };
let game, selected = null, latest = null, busy = false, running = false, ready = false;
let epoch = 0, aborter, timer, autoTurns = 0, sound = false, audio;
let calls = 0, cost = 0, hasUnknownCost = false;
const events = [];

function piece(type, color) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('piece', color === 'w' ? 'white' : 'black');
  svg.setAttribute('viewBox', '0 0 80 80'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/pieces.svg#${type}`); svg.append(use); return svg;
}

function cancel() {
  epoch++; running = false; busy = false; clearTimeout(timer); aborter?.abort(); aborter = null;
  selected = null; $('promotion-dialog').close();
}

function clearError() { $('error-message').hidden = true; }
function showError(message) { $('error-message').textContent = message; $('error-message').hidden = false; }
function humanSide() { return state.game === 'chess' ? 'White' : 'Red'; }
function canPlay() { return state.mode === 'human' && game.turn === humanSide() && !busy && !game.outcome && state.moves.length < MAX_MOVES; }

function reset({ kind = state.game, scenario = state.scenario } = {}) {
  cancel(); clearError(); latest = null; autoTurns = 0;
  state.game = kind; state.scenario = scenario; state.moves = [];
  $('scenario').replaceChildren(...SCENARIOS[kind].map(s => { const option = node('option', '', s.name); option.value = s.id; return option; }));
  $('scenario').value = scenario;
  $('game-title').textContent = kind === 'chess' ? 'chess?' : 'Connect Four?';
  document.title = `Can Jev play ${kind === 'chess' ? 'chess' : 'Connect Four'}? — The play lab`;
  for (const b of document.querySelectorAll('[data-game]')) { b.classList.toggle('active', b.dataset.game === kind); b.setAttribute('aria-pressed', b.dataset.game === kind); }
  $('board').replaceChildren();
  render();
}

function render({ animateMove = false } = {}) {
  game = createGame(state, Chess);
  renderBoard({ animateMove }); renderPlayers(); renderDecision(); renderLog();
  $('legal-count').textContent = game.legal.length;
  $('turn-label').textContent = game.outcome ? 'GAME COMPLETE' : `${game.turn.toUpperCase()} TO MOVE`;
  $('scenario-note').textContent = SCENARIOS[state.game].find(s => s.id === state.scenario).note;
  const finished = !!game.outcome;
  $('play-button').disabled = !finished && (!ready || state.moves.length >= MAX_MOVES || (busy && !running));
  $('play-button').textContent = finished ? 'Play again ↗' : running ? 'Ⅱ  Pause match' : busy ? 'Choosing a move…' : state.mode === 'watch' ? '▶  Watch Jev play' : '✦  Ask Jev to move';
  $('board-note').classList.toggle('game-result', finished);
  const result = !finished ? '' : game.outcome.winner
    ? `${game.outcome.winner} wins. ${game.outcome.reason}!`
    : game.outcome.reason === 'Draw' ? 'It’s a draw.' : `It’s a draw. ${game.outcome.reason}.`;
  $('board-note').textContent = finished ? result
    : busy ? `Jev is choosing from ${game.legal.length} legal actions…`
    : state.moves.length >= MAX_MOVES ? 'Turn limit reached. Start a new game.'
    : state.mode === 'watch' ? running ? 'A real API call on every turn. Pause at any time.' : 'Watch both sides. Each move is a live Jev decision.'
    : game.turn !== humanSide() ? 'Jev to move. Press “Ask Jev to move” to continue.'
    : state.game === 'chess' ? 'Click a white piece, then a highlighted square.' : 'Click a column to drop your red disc.';
}

function renderBoard({ animateMove = false } = {}) {
  const board = $('board');
  board.className = `board ${state.game === 'chess' ? 'chess-board' : 'connect-board'}`;
  board.classList.toggle('has-winner', state.game === 'connect' && !!game.outcome?.winner);
  board.setAttribute('aria-label', `${state.game === 'chess' ? 'Chess' : 'Connect Four'} board. ${game.outcome ? game.outcome.winner ? `${game.outcome.winner} wins.` : 'Draw.' : `${game.turn} to move.`}`);
  if (state.game === 'connect') {
    // Keep disc nodes in place so status updates cannot restart their animations.
    if (board.children.length !== 42) {
      board.replaceChildren();
      for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
        const button = node('button', 'connect-cell'), disc = node('span', 'disc');
        disc.addEventListener('animationend', () => disc.classList.remove('dropping'));
        button.append(disc);
        if (r === 5) button.append(node('span', 'coord', c + 1));
        button.addEventListener('click', () => humanMove(String(c + 1)));
        board.append(button);
      }
    }
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
      const button = board.children[r * 7 + c], disc = button.firstElementChild;
      const id = String(c + 1), color = game.board[r][c]?.toLowerCase() || '';
      button.setAttribute('aria-label', `Column ${id}, row ${r + 1}: ${game.board[r][c] || 'empty'}`);
      button.disabled = !canPlay() || !game.legal.some(m => m.id === id);
      if (disc.dataset.color !== color) {
        disc.dataset.color = color;
        disc.className = `disc ${color}`;
        if (animateMove && color) disc.classList.add('dropping');
      }
      button.classList.toggle('last', game.last?.[0] === r && game.last?.[1] === c);
      const winning = !!game.outcome?.cells?.some(([y, x]) => y === r && x === c);
      button.classList.toggle('winning', winning);
      if (winning) button.setAttribute('aria-label', `${button.getAttribute('aria-label')}, winning disc`);
    }
    return;
  }
  board.replaceChildren();
  const last = game.history.at(-1)?.id;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const square = `${'abcdefgh'[c]}${8 - r}`, p = game.board[r][c];
    const button = node('button', `square ${(r + c) % 2 ? 'dark' : 'light'}`);
    button.dataset.square = square;
    button.setAttribute('aria-label', `${square}${p ? ` ${p.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[p.type]}` : ' empty'}`);
    button.disabled = !canPlay();
    if (square === selected) button.classList.add('selected');
    if (selected && game.legal.some(m => m.from === selected && m.to === square)) button.classList.add('destination');
    if (last && (square === last.slice(0, 2) || square === last.slice(2, 4))) button.classList.add('last-move');
    if (p?.type === 'k' && (p.color === 'w' ? 'White' : 'Black') === game.turn && game.inCheck) {
      button.classList.add('in-check');
      if (game.outcome?.reason === 'Checkmate') {
        button.classList.add('checkmated');
        button.setAttribute('aria-label', `${button.getAttribute('aria-label')}, checkmated`);
      }
    }
    if (c === 0) button.append(node('span', 'coord rank', 8 - r));
    if (r === 7) button.append(node('span', 'coord file', 'abcdefgh'[c]));
    if (p) button.append(piece(p.type, p.color));
    button.addEventListener('click', () => selectSquare(square));
    board.append(button);
  }
}

function selectSquare(square) {
  if (!canPlay()) return;
  const options = game.legal.filter(m => m.from === selected && m.to === square);
  if (options.length > 1) {
    const version = epoch;
    $('promotion-options').replaceChildren(...options.map(m => {
      const button = node('button'); button.setAttribute('aria-label', `Promote to ${PIECE_NAMES[m.promotion]}`);
      button.append(piece(m.promotion, 'w'));
      button.addEventListener('click', () => { $('promotion-dialog').close(); if (version === epoch) humanMove(m.id); }); return button;
    }));
    $('promotion-dialog').showModal(); return;
  }
  if (options.length === 1) { humanMove(options[0].id); return; }
  selected = selected === square ? null : game.legal.some(m => m.from === square) ? square : null;
  renderBoard(); $('board').querySelector(`[data-square="${square}"]`)?.focus({ preventScroll: true });
}

function recordMove(id, actor, decision) {
  const next = { ...state, moves: [...state.moves, id] };
  createGame(next, Chess); // Validate before any client state change.
  events.push({ at: new Date().toISOString(), game: state.game, scenario: state.scenario, movesBefore: [...state.moves], choice: id, side: game.turn, actor, decision: decision ?? null });
  state.moves.push(id); selected = null; tick();
}

function humanMove(id) {
  if (!canPlay() || !game.legal.some(m => m.id === id)) return;
  clearError(); recordMove(id, 'You'); render({ animateMove: true });
  if (!game.outcome) void runJev();
}

async function runJev() {
  if (busy || !ready || game.outcome || state.moves.length >= MAX_MOVES) return;
  clearError(); const version = epoch;
  const snapshot = { game: state.game, scenario: state.scenario, moves: [...state.moves] };
  busy = true; calls++; const started = performance.now();
  aborter = new AbortController(); render();
  try {
    const response = await fetch('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot), signal: aborter.signal });
    const data = await response.json();
    if (version !== epoch) return;
    if (!response.ok) throw new Error(data.error || 'The request failed. Try again.');
    if (!game.legal.some(m => m.id === data.choice)) throw new Error('The returned move does not fit this board.');
    latest = data;
    if (data.usage.cost !== null) cost += data.usage.cost; else hasUnknownCost = true;
    recordMove(data.choice, 'Jev', data); autoTurns++;
    busy = false; aborter = null; render({ animateMove: true });
    if (running && !game.outcome && autoTurns < 80 && state.moves.length < MAX_MOVES) {
      timer = setTimeout(() => { if (version === epoch && running) void runJev(); }, Math.max(900, 2300 - (performance.now() - started)));
    } else if (running) {
      running = false; render();
      if (!game.outcome) $('board-note').textContent = 'Auto-play paused after 80 turns. Press play to continue.';
    }
  } catch (error) {
    if (version !== epoch) return;
    running = false; busy = false; aborter = null;
    showError(error.name === 'AbortError' ? 'The move was cancelled.' : error.message); render();
  }
}

function renderPlayers() {
  const top = state.game === 'chess' ? 'Black' : 'Yellow', bottom = humanSide();
  $('top-side').textContent = state.game === 'chess' ? 'BLACK PIECES' : 'YELLOW DISCS';
  $('bottom-side').textContent = state.game === 'chess' ? 'WHITE PIECES' : 'RED DISCS';
  $('bottom-name').textContent = state.mode === 'watch' ? 'Jev 1.13' : 'You';
  $('bottom-avatar').textContent = state.mode === 'watch' ? 'j.' : 'Y';
  $('bottom-avatar').className = `player-avatar ${state.mode === 'watch' ? 'bot-avatar' : 'human-avatar'}`;
  for (const [id, side] of [['top-state', top], ['bottom-state', bottom]]) {
    const current = game.turn === side && !game.outcome;
    $(id).classList.toggle('current', current);
    $(id).textContent = game.outcome ? 'Finished' : current ? busy ? 'Choosing…' : state.mode === 'human' && side === bottom ? 'Your move' : 'To move' : 'Waiting';
  }
}

function renderDecision() {
  document.querySelector('.decision-panel').classList.toggle('thinking', busy);
  $('live-badge').textContent = busy ? 'THINKING' : latest ? 'LIVE RESULT' : 'LIVE API';
  $('live-badge').classList.toggle('busy', busy);
  $('decision-caption').textContent = busy ? `${game.turn.toUpperCase()} · CHOOSING` : latest ? `${latest.side.toUpperCase()} · JEV CHOSE` : 'JEV’S NEXT MOVE';
  $('chosen-move').textContent = busy ? 'Let’s see…' : latest ? state.game === 'connect' ? `Column ${latest.choice}` : latest.label : state.mode === 'watch' ? 'Ready to play.' : 'Your move ↙';
  $('decision-description').textContent = busy ? `${game.legal.length} legal moves. One live decision.` : latest ? latest.description : state.mode === 'watch' ? 'Press play to watch the model take both sides.' : 'Make a move. Then watch Jev choose its reply.';
  if (latest && !busy) {
    $('candidates').replaceChildren(...latest.probabilities.slice(0, 4).map(option => {
      const item = node('div', `candidate ${option.id === latest.choice ? 'chosen' : ''}`);
      item.title = option.description;
      const track = node('div', 'bar-track'), fill = node('div', 'bar-fill');
      fill.style.width = `${option.probability * 100}%`; track.append(fill);
      item.append(node('span', 'candidate-label', state.game === 'connect' ? `Col ${option.id}` : option.label), track, node('span', 'candidate-percent', `${Math.round(option.probability * 100)}%`));
      return item;
    }));
    $('latency').replaceChildren(document.createTextNode(latest.latencyMs.toLocaleString()), node('small', '', ' ms'));
    $('confidence').textContent = latest.confidence === null ? '—' : `${Math.round(latest.confidence * 100)}%`;
  } else {
    const empty = node('div', 'empty-candidates');
    empty.append(node('span', 'ghost-bar'), node('span', 'ghost-bar'), node('span', 'ghost-bar'), node('p', '', 'The options will appear here.'));
    $('candidates').replaceChildren(empty); $('latency').textContent = '—'; $('confidence').textContent = '—';
  }
  $('call-count').textContent = calls;
  $('session-cost').textContent = `$${cost.toFixed(6)}${hasUnknownCost ? '+' : ''}`;
  $('session-cost').title = 'Reported cost of completed responses in this page session. Cancelled or failed calls may still be billed.';
}

function renderLog() {
  const setupLength = state.game === 'connect' ? SCENARIOS.connect.find(s => s.id === state.scenario).setup.length : 0;
  const history = game.history.slice(setupLength);
  if (!history.length) { $('move-log').replaceChildren(node('p', 'empty-log', 'Every great game starts somewhere.')); return; }
  const rows = history.map((m, i) => {
    const event = events.findLast(e => e.game === state.game && e.scenario === state.scenario && e.movesBefore.length === i && e.choice === m.id && e.movesBefore.every((move, j) => move === state.moves[j]));
    const row = node('div', 'move-entry');
    row.append(node('span', 'move-number', `${i + 1}.`), node('b', '', m.label), node('span', 'actor', `${m.side} · ${event?.actor || 'You'}`), node('span', 'time', event?.decision ? `${event.decision.latencyMs} ms` : '—'));
    return row;
  });
  $('move-log').replaceChildren(...rows); $('move-log').scrollTop = $('move-log').scrollHeight;
}

function tick() {
  if (!sound) return;
  try {
    audio ||= new AudioContext(); audio.resume();
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(620, audio.currentTime); osc.frequency.exponentialRampToValueAtTime(250, audio.currentTime + .08);
    gain.gain.setValueAtTime(.05, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .1);
    osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .1);
  } catch { /* Sound is optional. */ }
}

for (const b of document.querySelectorAll('[data-game]')) b.addEventListener('click', () => { if (b.dataset.game !== state.game) reset({ kind: b.dataset.game, scenario: 'opening' }); });
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => {
  if (b.dataset.mode === state.mode) return;
  cancel(); clearError(); state.mode = b.dataset.mode;
  for (const other of document.querySelectorAll('[data-mode]')) { other.classList.toggle('active', other === b); other.setAttribute('aria-pressed', other === b); }
  render();
});
$('scenario').addEventListener('change', e => reset({ scenario: e.target.value }));
$('reset-button').addEventListener('click', () => reset());
$('play-button').addEventListener('click', () => {
  if (game.outcome) { reset(); return; }
  if (running) { cancel(); render(); return; }
  if (state.mode === 'watch') { running = true; autoTurns = 0; }
  void runJev();
});
$('sound-button').addEventListener('click', () => {
  sound = !sound; $('sound-button').setAttribute('aria-pressed', sound);
  $('sound-button').setAttribute('aria-label', `Turn move sounds ${sound ? 'off' : 'on'}`); tick();
});
$('about-button').addEventListener('click', () => $('about-dialog').showModal());
$('close-about').addEventListener('click', () => $('about-dialog').close());
$('cancel-promotion').addEventListener('click', () => $('promotion-dialog').close());
$('export-button').addEventListener('click', () => {
  const payload = { exportedAt: new Date().toISOString(), model: 'typesafe/jev-1.13', currentGame: state, recordedCalls: calls, reportedCost: cost, costNote: 'Completed responses only. Failed or cancelled requests may still be billed.', events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = node('a'); a.href = url; a.download = `jev-${state.game}-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

reset();
try {
  const response = await fetch('/api/status');
  const status = await response.json(); ready = response.ok && status.ready;
  if (!ready) showError('Set OPENROUTER_API_KEY in the server environment, then restart. You can still explore the board.');
  render();
} catch {
  showError('The local server is unavailable. Run npm start, then reload.');
}
