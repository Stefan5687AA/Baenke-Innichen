import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const PUBLIC_DIR = resolve(process.cwd(), 'public');
const PORT = Number.parseInt(process.env.PORT || '4173', 10);

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`).pathname;
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidatePath = resolve(join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath.slice(1)));

  const filePath = candidatePath.startsWith(PUBLIC_DIR) && existsSync(candidatePath) && statSync(candidatePath).isFile()
    ? candidatePath
    : join(PUBLIC_DIR, 'index.html');

  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });

  createReadStream(filePath).pipe(response);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Frontend running at http://127.0.0.1:${PORT}`);
});
