import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { createGame } from './public/game.js';
import { askJev, MODEL, PublicError } from './lib/jev.mjs';

const FILES = {
  '/': ['public/index.html', 'text/html'],
  '/app.js': ['public/app.js', 'text/javascript'],
  '/game.js': ['public/game.js', 'text/javascript'],
  '/style.css': ['public/style.css', 'text/css'],
  '/pieces.svg': ['public/pieces.svg', 'image/svg+xml'],
  '/vendor/chess.js': ['node_modules/chess.js/dist/esm/chess.js', 'text/javascript'],
};

export function createApp({ apiKey = process.env.OPENROUTER_API_KEY, decide = askJev, requestBudget = 300 } = {}) {
  let active = false, calls = 0;
  let recent = [];
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const port = req.socket.localPort;
      const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      if (!allowedHosts.includes(req.headers.host)) throw new PublicError('This demo only accepts local requests.', 403);
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) throw new PublicError('Cross-site requests are not allowed.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new PublicError('Cross-site requests are not allowed.', 403);
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (path === '/api/status' && req.method === 'GET') return json(200, { ready: Boolean(apiKey), model: MODEL, remainingCalls: requestBudget - calls });
      if (path === '/api/move' && req.method === 'POST') {
        if (!origin) throw new PublicError('A local Origin header is required.', 403);
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new PublicError('Send JSON.', 415);
        if (active) throw new PublicError('Jev is already choosing a move.', 429);
        recent = recent.filter(t => t > Date.now() - 60000);
        if (recent.length >= 30) throw new PublicError('Pause for a minute. The demo allows 30 calls per minute.', 429);
        if (calls >= requestBudget) throw new PublicError('The local request limit was reached. Restart the server to continue.', 429);
        if (Number(req.headers['content-length'] || 0) > 32768) throw new PublicError('Move history is too large.', 413);
        let body = '', bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 32768) throw new PublicError('Move history is too large.', 413);
          body += chunk.toString('utf8');
        }
        let game;
        try { game = createGame(JSON.parse(body), Chess); }
        catch { throw new PublicError('Invalid game, starting position, or move history.'); }
        if (game.outcome) throw new PublicError('This game has ended. Start a new game.');
        // Check again after body parsing so simultaneous requests cannot pass together.
        if (active) throw new PublicError('Jev is already choosing a move.', 429);
        recent = recent.filter(t => t > Date.now() - 60000);
        if (recent.length >= 30 || calls >= requestBudget) throw new PublicError('The local request limit was reached. Wait a minute, or restart after the session limit.', 429);
        active = true; calls++; recent.push(Date.now());
        const controller = new AbortController();
        const close = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', close);
        try { return json(200, await decide(game, { apiKey, signal: controller.signal })); }
        finally { active = false; res.off('close', close); }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new PublicError('Method not allowed.', 405);
      const file = FILES[path];
      if (!file) throw new PublicError('Not found.', 404);
      const content = await readFile(new URL(file[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(error instanceof PublicError ? error.status : 500, { error: error instanceof PublicError ? error.message : 'The local server could not complete the request.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  const server = createApp();
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.listen(port, '127.0.0.1', () => console.log(`Can Jev play? Open http://localhost:${port} · API key ${process.env.OPENROUTER_API_KEY ? 'set' : 'missing'}`));
}
