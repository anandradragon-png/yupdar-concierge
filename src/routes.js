/**
 * HTTP surface of the concierge — four small handlers behind `/api/*`.
 *
 *   POST /api/start    { birth_date, email }        → session + Gift card
 *   POST /api/chat     { session, message }         → reply + recommendation
 *   POST /api/checkout { session, kind, key }       → PayPal approve URL (via core)
 *   POST /api/status   { session }                  → what is unlocked (via core)
 *
 * The model's answer is JSON by contract; if it drifts, `parseReply` keeps the
 * text and drops the recommendation rather than failing the turn. A
 * recommendation is accepted only if its key exists in the session's catalog.
 */

'use strict';

const core = require('./core-client');
const llm = require('./llm-client');
const sessions = require('./sessions');
const { buildSystemPrompt } = require('./system-prompt');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function catalogHas(catalog, rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.kind === 'book') return rec.key === 'book';
  if (rec.kind === 'plan') return catalog.plans.some(p => p.key === rec.key);
  if (rec.kind === 'addon') return catalog.addons.some(a => a.key === rec.key);
  return false;
}

function priceOf(catalog, rec) {
  if (rec.kind === 'book') return catalog.book.usd;
  const list = rec.kind === 'plan' ? catalog.plans : catalog.addons;
  const item = list.find(x => x.key === rec.key);
  return item ? item.usd : null;
}

/** Model output → { reply, recommend }. Tolerates prose around the JSON. */
function parseReply(text, catalog) {
  const raw = String(text || '').trim();
  let obj = null;
  try { obj = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch { obj = null; } }
  }
  if (!obj || typeof obj.reply !== 'string') return { reply: raw || '…', recommend: null };
  const rec = catalogHas(catalog, obj.recommend) ? { kind: obj.recommend.kind, key: obj.recommend.key } : null;
  if (rec) rec.usd = priceOf(catalog, rec);
  return { reply: obj.reply.trim(), recommend: rec };
}

async function start(req, res) {
  const { birth_date, email } = req.body || {};
  const clean = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return res.status(400).json({ error: 'A valid email is needed to unlock what you buy.' });
  const r = await core.profile(birth_date);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  const s = sessions.create({ profile: r.data, email: clean });
  const p = r.data;
  return res.json({
    session: s.id,
    gift: { code: p.dar_code, name: p.name_en || p.name_ru, metaphor: p.archetype_en || p.metaphor_ru, essence: p.essence_en || p.essence_short_ru },
    catalog: p.catalog
  });
}

async function chat(req, res) {
  const s = sessions.get(req.body && req.body.session);
  if (!s) return res.status(410).json({ error: 'Session expired. Start again.' });
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'Empty message.' });
  if (!llm.isConfigured()) return res.status(503).json({ error: 'AI is not configured (LLM_API_KEY).' });

  sessions.push(s, 'user', message);
  const messages = [{ role: 'system', content: buildSystemPrompt(s.profile) }, ...s.messages];
  let out;
  try {
    out = await llm.chat({ messages });
  } catch (e) {
    s.messages.pop();
    return res.status(502).json({ error: 'The model did not answer: ' + e.message });
  }
  const parsed = parseReply(out.content, s.profile.catalog);
  sessions.push(s, 'assistant', JSON.stringify({ reply: parsed.reply, recommend: parsed.recommend && { kind: parsed.recommend.kind, key: parsed.recommend.key } }));
  return res.json({ reply: parsed.reply, recommend: parsed.recommend, model: out.model });
}

async function checkout(req, res) {
  const s = sessions.get(req.body && req.body.session);
  if (!s) return res.status(410).json({ error: 'Session expired. Start again.' });
  const rec = { kind: req.body.kind, key: req.body.key };
  if (!catalogHas(s.profile.catalog, rec)) return res.status(400).json({ error: 'Unknown product.' });
  const r = await core.checkout(s.email, rec.kind, rec.key);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  return res.json(r.data);
}

async function status(req, res) {
  const s = sessions.get(req.body && req.body.session);
  if (!s) return res.status(410).json({ error: 'Session expired. Start again.' });
  const r = await core.status(s.email);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  return res.json(r.data);
}

module.exports = { start, chat, checkout, status, parseReply, catalogHas };
