import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

export function startServer({ port = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let path = decodeURI(req.url.split('?')[0]);
      if (path === '/') path = '/index.html';
      const filePath = normalize(join(ROOT, path));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
      res.end(readFileSync(filePath));
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://localhost:${actual}/`,
        close: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}
