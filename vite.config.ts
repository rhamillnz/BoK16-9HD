import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// Original game files are never copied into the repo. In dev they are served
// read-only from the user's install directory under /bak/.
export const BAK_DIR =
  process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';

function serveGameData(): Plugin {
  return {
    name: 'serve-bak-data',
    configureServer(server) {
      server.middlewares.use('/bak/', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
        const file = path.resolve(BAK_DIR, name);
        if (!file.startsWith(path.resolve(BAK_DIR)) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [serveGameData()],
});
