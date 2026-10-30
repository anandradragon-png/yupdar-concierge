/**
 * Conversations live in process memory: profile, catalog, last messages.
 *
 * Enough for a demo and for a single-instance deployment. Nothing personal is
 * persisted here: a restart forgets everything. The page keeps the person's
 * own conversation in their browser and, when the server has forgotten the
 * session, starts a new one seeded with that history (`create({ messages })`),
 * so nobody types their date and questions twice. Sessions idle for a day
 * are dropped.
 */

'use strict';

const crypto = require('crypto');

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TURNS = 12; // user+assistant messages kept for the model

const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.touched > TTL_MS) sessions.delete(id);
}

function create({ profile, email, messages }) {
  sweep();
  const id = crypto.randomBytes(16).toString('hex');
  sessions.set(id, { id, profile, email, messages: [], touched: Date.now() });
  const s = sessions.get(id);
  for (const m of messages || []) push(s, m.role, m.content);
  return s;
}

function get(id) {
  const s = sessions.get(String(id || ''));
  if (!s) return null;
  if (Date.now() - s.touched > TTL_MS) { sessions.delete(s.id); return null; }
  s.touched = Date.now();
  return s;
}

function push(session, role, content) {
  session.messages.push({ role, content: String(content).slice(0, 4000) });
  if (session.messages.length > MAX_TURNS) session.messages.splice(0, session.messages.length - MAX_TURNS);
}

module.exports = { create, get, push, TTL_MS };
