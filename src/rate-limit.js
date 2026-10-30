/**
 * Per-visitor request limit, in memory.
 *
 * The YupDar core limits the concierge by the concierge's own address — one
 * address for every visitor. Without a limit here one script could create
 * accounts with "save my Gift", burn model tokens and, by exhausting the
 * core's limit, lock everyone else out. Counted per visitor IP: the last
 * X-Forwarded-For entry is the one our own proxy added (the first one can be
 * typed by the client), falling back to the socket address.
 */

'use strict';

const hits = new Map(); // key → [timestamps]

function visitorIp(req) {
  const xff = String((req.headers && req.headers['x-forwarded-for']) || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : ((req.socket && req.socket.remoteAddress) || 'unknown');
}

/**
 * Express middleware: at most `limit` requests per `windowMs` per visitor and bucket.
 */
function limit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = bucket + ':' + visitorIp(req);
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
    return next();
  };
}

function reset() { hits.clear(); }

module.exports = { limit, visitorIp, reset };
