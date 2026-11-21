import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { buildApi } from './api.ts';
import { getDb } from './db.ts';

export function buildServer() {
  const db = getDb();
  const app = new Hono();
  app.route('/api', buildApi(db));
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use('/assets/*', serveStatic({ root: './dist' }));
    app.get('*', (c) => {
      const f = path.join(dist, c.req.path === '/' ? 'index.html' : c.req.path);
      if (c.req.path !== '/' && fs.existsSync(f) && fs.statSync(f).isFile()) return new Response(fs.readFileSync(f));
      return c.html(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'));
    });
  } else {
    app.get('/', (c) => c.text('API is running. Build the UI with `npm run build` or use `npm run dev`.'));
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';
  serve({ fetch: buildServer().fetch, port, hostname: host }, (i) => console.log(`[server] http://${host}:${i.port}`));
}
