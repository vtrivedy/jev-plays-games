export const MODEL = 'typesafe/jev-1.13';
export const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

export class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function decisionRequest(game) {
  if (game.outcome || !game.legal.length) throw new PublicError('This game has ended. Start a new game.');
  return {
    model: MODEL,
    state: game.position,
    questions: { move: {
      type: 'choice',
      instructions: game.game === 'chess'
        ? `Choose the strongest chess move for ${game.turn} in this position. Select one of the legal moves. Aim to win by checkmate; protect your king and pieces.`
        : `Choose the strongest Connect Four move for ${game.turn}. Select one legal column. Make four in a row or block the opponent's immediate winning threat.`,
      criteria: Object.fromEntries(game.legal.map(m => [m.id, m.label])),
    } },
  };
}

function probability(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }

export function validateAnswer(data, game) {
  const answer = data?.answers?.move;
  const move = game.legal.find(m => m.id === answer?.choice);
  if (!move || answer.type !== 'choice') throw new PublicError('Jev returned an invalid action. No move was made.', 502);
  if (answer.confidence !== undefined && !probability(answer.confidence)) throw new PublicError('Jev returned an invalid confidence value.', 502);
  if (!answer.probabilities || typeof answer.probabilities !== 'object' || Array.isArray(answer.probabilities)) throw new PublicError('Jev did not return choice probabilities.', 502);
  for (const [id, p] of Object.entries(answer.probabilities)) {
    if (!game.legal.some(m => m.id === id) || !probability(p)) throw new PublicError('Jev returned invalid choice probabilities.', 502);
  }
  if (game.legal.some(m => !Object.hasOwn(answer.probabilities, m.id))) throw new PublicError('Jev returned incomplete choice probabilities.', 502);
  const finiteNonnegative = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
  return {
    choice: move.id, label: move.san, description: move.label,
    confidence: answer.confidence ?? null,
    probabilities: game.legal.map(m => ({ id: m.id, label: m.san, description: m.label, probability: answer.probabilities[m.id] })).sort((a, b) => b.probability - a.probability),
    usage: { inputTokens: finiteNonnegative(data.usage?.input_tokens), outputTokens: finiteNonnegative(data.usage?.output_tokens), cost: finiteNonnegative(data.usage?.cost) },
    model: MODEL,
  };
}

export async function askJev(game, { apiKey, fetchImpl = fetch, signal } = {}) {
  if (!apiKey) throw new PublicError('Set OPENROUTER_API_KEY, then restart the server.', 503);
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Can Jev Play?' },
      body: JSON.stringify(decisionRequest(game)),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
  } catch {
    throw new PublicError('Jev could not be reached within 20 seconds. Try again.', 504);
  }
  if (!response.ok) {
    await response.body?.cancel();
    const errors = { 401: 'OpenRouter rejected the API key.', 402: 'The OpenRouter account needs credits.', 429: 'OpenRouter is busy. Wait a moment and try again.' };
    throw new PublicError(errors[response.status] || `OpenRouter returned an error (${response.status}). Try again.`, 502);
  }
  // Bound the response before parsing it. No upstream error bodies or headers are logged.
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 128 * 1024) throw new Error('Response too large');
      chunks.push(chunk);
    }
    const result = validateAnswer(JSON.parse(Buffer.concat(chunks).toString('utf8')), game);
    return { ...result, latencyMs: Math.round(performance.now() - started), legalCount: game.legal.length, side: game.turn };
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError('Jev returned an unreadable response. No move was made.', 502);
  }
}
