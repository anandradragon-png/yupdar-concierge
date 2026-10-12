/**
 * The only bridge to the YupDar core: one endpoint, one bearer key.
 *
 * The core is closed source. Everything the concierge knows about a person's
 * Gift, the catalog and payments comes from `POST ${CORE_API_URL}` with
 * `{ action }`. The concierge never computes a Gift, never stores prices and
 * never touches PayPal directly — the core does, and its answer is final.
 *
 * `fetchImpl` is a parameter so the client is tested without a network.
 */

'use strict';

function config() {
  return {
    url: (process.env.CORE_API_URL || '').trim(),
    key: (process.env.CORE_API_KEY || '').trim()
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.url && c.key);
}

/**
 * @returns {{ok: true, data: object} | {ok: false, status: number, error: string}}
 */
async function callCore(action, payload, fetchImpl) {
  const { url, key } = config();
  if (!url || !key) return { ok: false, status: 503, error: 'core not configured (CORE_API_URL, CORE_API_KEY)' };

  const doFetch = fetchImpl || ((...a) => fetch(...a));
  let resp;
  try {
    resp = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ action, ...(payload || {}) })
    });
  } catch (e) {
    return { ok: false, status: 502, error: 'core unreachable: ' + e.message };
  }
  let data = {};
  try { data = await resp.json(); } catch { /* non-JSON body: handled below */ }
  if (!resp.ok) return { ok: false, status: resp.status, error: (data && data.error) || `core http ${resp.status}` };
  return { ok: true, data };
}

const profile  = (birth_date, f)        => callCore('profile',  { birth_date }, f);
const checkout = (email, kind, key, f)  => callCore('checkout', { email, kind, key }, f);
const status   = (email, f)             => callCore('status',   { email }, f);

module.exports = { isConfigured, callCore, profile, checkout, status };
