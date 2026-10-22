import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import configuration from '../../../apps/web/vercel.json' with { type: 'json' };

const webRoot = fileURLToPath(new URL('../../../apps/web/dist/', import.meta.url));
const contentTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

// This fixture exercises the built files and CSP in Chromium, not Vercel's routing engine.
export async function startProductionWeb(mode: 'report-only' | 'enforced') {
  const server = createServer((request, response) => {
    void serve().catch(() => {
      response.writeHead(500).end();
    });
    async function serve() {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      for (const rule of configuration.headers) {
        if (new RegExp(`^${rule.source}$`).test(pathname)) {
          for (const header of rule.headers) {
            const key =
              mode === 'enforced' && header.key === 'Content-Security-Policy-Report-Only'
                ? 'Content-Security-Policy'
                : header.key;
            response.setHeader(key, header.value);
          }
        }
      }
      // No request can reach the configured hosted API from this local fixture.
      if (/^\/api(?:\/|$)/.test(pathname)) {
        response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      const filePath = resolve(webRoot, `.${decodeURIComponent(pathname)}`);
      if (relative(webRoot, filePath).startsWith('..')) {
        response.writeHead(404).end();
        return;
      }
      let body: Buffer;
      let extension = extname(filePath);
      try {
        body = await readFile(filePath);
      } catch {
        const fallback = configuration.rewrites.some(
          (rule) =>
            rule.destination === '/index.html' && new RegExp(`^${rule.source}$`).test(pathname),
        );
        if (!fallback) {
          response.writeHead(404).end();
          return;
        }
        body = await readFile(resolve(webRoot, 'index.html'));
        extension = '.html';
      }
      response.writeHead(200, {
        'content-type': contentTypes[extension] ?? 'application/octet-stream',
      });
      response.end(body);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a loopback web listener.');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    },
  };
}
