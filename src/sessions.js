/**
 * Conversations live in process memory: profile, catalog, last messages.
 *
 * Enough for a demo and for a single-instance deployment. Nothing personal is
 * persisted: a restart forgets everything, and the person simply starts again
 * from their birth date. Sessions idle for an hour are dropped.
 */

'use strict';

const crypto = require('crypto');

const TTL_MS = 60 * 60 * 1000;
const MAX_TURNS = 12; // user+assistant messages kept for the model

const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.touched > TTL_MS) sessions.delete(id);
}

function create({ profile, email }) {
  sweep();
  const id = crypto.randomBytes(16).toString('hex');
  sessions.set(id, { id, profile, email, messages: [], touched: Date.now() });
  return sessions.get(id);
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
