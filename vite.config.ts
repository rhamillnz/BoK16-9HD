import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveArtPath } from './src/assets/artServe';

// Original game files are never copied into the repo. In dev they are served
// read-only from the user's install directory under /bak/.
export const BAK_DIR = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';

function serveGameData(): Plugin {
  return {
    name: 'serve-bak-data',
    configureServer(server) {
      server.middlewares.use('/bak/', (req, res) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
        const file = path.resolve(BAK_DIR, name);
        // Misses must be real 404s: the SPA fallback would answer with index.html (status 200), which
        // the game then parses as data (a missing tile encounter file read past its end in chapter 6).
        if (!file.startsWith(path.resolve(BAK_DIR)) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          return res.end();
        }
        // Audio elements need the size and byte ranges to show a length and to seek.
        const size = statSync(file).size;
        res.setHeader('Content-Type', /\.ogg$/i.test(file) ? 'audio/ogg' : 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', end - start + 1);
          return createReadStream(file, { start, end }).pipe(res);
        }
        res.setHeader('Content-Length', size);
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Upscaled sprite replacements live in the gitignored art/reference folder and are served
// from /art/ in dev (e.g. /art/Z01/slots-4x/3.png). Misses are real 404s, not the SPA fallback.
function serveArt(): Plugin {
  const root = path.resolve('art/reference');
  return {
    name: 'serve-art-reference',
    configureServer(server) {
      server.middlewares.use('/art/', (req, res, next) => {
        const file = resolveArtPath(root, req.url ?? '');
        if (!file) return next();
        if (!existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', 'image/png');
        createReadStream(file).pipe(res);
      });
    },
  };
}

// The music browser (music.html) keeps the player's notes on each track in docs/music-notes.json.
function musicNotes(): Plugin {
  const file = path.resolve('docs/music-notes.json');
  return {
    name: 'music-notes',
    configureServer(server) {
      server.middlewares.use('/api/music-notes', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c: Buffer) => (body += c.toString('utf8')));
          req.on('end', () => {
            try {
              const notes = JSON.parse(body) as Record<string, string>;
              writeFileSync(file, JSON.stringify(notes, null, 2) + '\n', 'utf8');
              res.statusCode = 204;
            } catch {
              res.statusCode = 400;
            }
            res.end();
          });
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(existsSync(file) ? readFileSync(file, 'utf8') : '{}');
      });
    },
  };
}

export default defineConfig({
  base: './', // relative asset URLs: the build works from any static host or sub-path
  plugins: [serveGameData(), serveArt(), musicNotes()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { viewer: 'index.html', game: 'game.html' },
    },
  },
});
