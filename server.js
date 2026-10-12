/**
 * YupDar Concierge — a small Express server: one static page and four JSON
 * handlers (`src/routes.js`). Talks to the YupDar core over HTTPS and to
 * Nemotron on Nebius Token Factory. Nothing else.
 */

'use strict';

const path = require('path');
const express = require('express');
const routes = require('./src/routes');

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  const wrap = fn => (req, res) => fn(req, res).catch(e => {
    console.error('[concierge]', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
  });
  app.post('/api/start', wrap(routes.start));
  app.post('/api/chat', wrap(routes.chat));
  app.post('/api/checkout', wrap(routes.checkout));
  app.post('/api/status', wrap(routes.status));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
  return app;
}

if (require.main === module) {
  try { require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }); } catch { /* no .env — rely on the environment */ }

  const port = Number(process.env.PORT) || 3100;
  buildApp().listen(port, () => console.log(`YupDar Concierge on http://localhost:${port}`));
}

module.exports = { buildApp };
