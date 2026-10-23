/**
 * Servidor estático mínimo (sin dependencias) para probar la web en local:
 *   npm run web   →   http://localhost:8080/web/
 * Sirve la raíz del repositorio porque la web importa el código de extension/lib.
 * En el celular hace falta HTTPS: publica en GitHub Pages (ver README).
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

export function createStaticServer(root = ROOT) {
  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    let file = path.join(root, decodeURIComponent(pathname));
    if (!file.startsWith(root) || file.split(path.sep).includes('node_modules')) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await fs.stat(file)).isDirectory()) {
        if (!pathname.endsWith('/')) {
          res.writeHead(301, { location: `${pathname}/` }).end();
          return;
        }
        file = path.join(file, 'index.html');
      }
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  createStaticServer().listen(port, () => {
    console.log(`Web lista en http://localhost:${port}/web/`);
  });
}
