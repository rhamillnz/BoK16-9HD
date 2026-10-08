import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
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
        res.setHeader('Content-Type', 'application/octet-stream');
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

export default defineConfig({
  base: './', // relative asset URLs: the build works from any static host or sub-path
  plugins: [serveGameData(), serveArt()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { viewer: 'index.html', game: 'game.html' },
    },
  },
});
