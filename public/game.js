export const SCENARIOS = {
  chess: [
    { id: 'opening', name: 'Fresh board', note: 'The classic. Make the first move.', fen: undefined },
    { id: 'fools-mate', name: 'Find the finish', note: 'Black has a mate in one. Can Jev find it?', fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2' },
    { id: 'back-rank', name: 'Back-rank puzzle', note: 'White has a mate in one. One chance to see it.', fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1' },
  ],
  connect: [
    { id: 'opening', name: 'Fresh board', note: 'Four in a row. Seven possible actions.', setup: [] },
    { id: 'win-now', name: 'Find the finish', note: 'Red can win this turn. Can Jev see the line?', setup: [0, 6, 1, 6, 2, 5] },
    { id: 'block-now', name: 'Block the threat', note: 'Yellow must stop an immediate win.', setup: [0, 6, 1, 6, 2] },
  ],
};

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const MAX_MOVES = 160;

function validate(input) {
  if (!input || !['chess', 'connect'].includes(input.game)) throw new Error('Choose a valid game.');
  const scenario = SCENARIOS[input.game].find(s => s.id === input.scenario);
  if (!scenario) throw new Error('Choose a valid starting position.');
  if (!Array.isArray(input.moves) || input.moves.length > MAX_MOVES || input.moves.some(m => typeof m !== 'string' || m.length > 5)) {
    throw new Error('Move history is invalid or too long.');
  }
  return scenario;
}

function uci(move) { return move.from + move.to + (move.promotion || ''); }

export function createGame(input, Chess) {
  const scenario = validate(input);
  if (input.game === 'connect') return connectGame(scenario, input.moves);
  const chess = new Chess(scenario.fen);
  for (const id of input.moves) {
    if (chess.isGameOver()) throw new Error('This game has already ended.');
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(id)) throw new Error('Invalid chess action.');
    chess.move({ from: id.slice(0, 2), to: id.slice(2, 4), promotion: id[4] });
  }
  const turn = chess.turn() === 'w' ? 'White' : 'Black';
  let outcome = null;
  if (chess.isCheckmate()) outcome = { winner: turn === 'White' ? 'Black' : 'White', reason: 'Checkmate' };
  else if (chess.isDraw()) outcome = { winner: null, reason: chess.isStalemate() ? 'Stalemate' : chess.isThreefoldRepetition() ? 'Threefold repetition' : chess.isInsufficientMaterial() ? 'Insufficient material' : 'Draw' };
  const legal = outcome ? [] : chess.moves({ verbose: true }).map(m => ({
    id: uci(m), from: m.from, to: m.to, promotion: m.promotion,
    piece: m.piece, color: m.color, san: m.san,
    // Do not leak the rules engine's check or mate annotations to the model.
    label: `Move ${turn.toLowerCase()} ${PIECE_NAMES[m.piece]} from ${m.from} to ${m.to}${m.promotion ? ` and promote to ${PIECE_NAMES[m.promotion]}` : ''}.`,
  }));
  const board = chess.board();
  const history = chess.history({ verbose: true });
  return {
    game: 'chess', turn, board, legal, outcome, inCheck: chess.inCheck(),
    fen: chess.fen(), history: history.map(m => ({ id: uci(m), label: m.san, side: m.color === 'w' ? 'White' : 'Black' })),
    position: {
      game: 'chess', side_to_move: turn, fen: chess.fen(),
      pieces: Object.fromEntries(['w', 'b'].map(color => [color === 'w' ? 'white' : 'black', board.flat().filter(p => p?.color === color).map(p => `${PIECE_NAMES[p.type]} on ${p.square}`)])),
      recent_moves: history.slice(-8).map(m => uci(m)),
      goal: 'Win by checkmate. Choose your own move from the legal options.',
    },
  };
}

function findFour(board) {
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
    if (!board[r][c]) continue;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = Array.from({ length: 4 }, (_, i) => [r + dr * i, c + dc * i]);
      if (cells.every(([y, x]) => board[y]?.[x] === board[r][c])) return { winner: board[r][c], cells };
    }
  }
  return null;
}

function connectGame(scenario, moves) {
  const board = Array.from({ length: 6 }, () => Array(7).fill(null));
  const history = [];
  let turn = 'Red', outcome = null, last = null;
  for (const id of [...scenario.setup.map(c => String(c + 1)), ...moves]) {
    if (outcome) throw new Error('This game has already ended.');
    if (!/^[1-7]$/.test(id)) throw new Error('Choose a column from 1 to 7.');
    const col = Number(id) - 1;
    let row = 5;
    while (row >= 0 && board[row][col]) row--;
    if (row < 0) throw new Error('That column is full.');
    board[row][col] = turn;
    last = [row, col];
    history.push({ id, label: `Column ${id}`, side: turn });
    const win = findFour(board);
    if (win) outcome = { ...win, reason: 'Four in a row' };
    else if (board[0].every(Boolean)) outcome = { winner: null, reason: 'Board full' };
    turn = turn === 'Red' ? 'Yellow' : 'Red';
  }
  return {
    game: 'connect', turn, board, outcome, last, history, inCheck: false,
    legal: outcome ? [] : board[0].flatMap((cell, i) => cell ? [] : [{ id: String(i + 1), san: String(i + 1), label: `Drop a ${turn.toLowerCase()} disc into column ${i + 1}.` }]),
    position: {
      game: 'Connect Four', side_to_move: turn,
      rules: 'Drop a disc into a column. It falls into the lowest empty cell. First to make four of their own discs in a horizontal, vertical, or diagonal line wins.',
      board_rows_top_to_bottom: board.map(row => row.map(cell => cell || 'empty')),
      columns_left_to_right: [1, 2, 3, 4, 5, 6, 7],
      goal: 'Choose the best column for the player whose turn it is. Win if possible; otherwise prevent the opponent from winning.',
    },
  };
}
