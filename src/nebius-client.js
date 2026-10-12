/**
 * Nebius Token Factory client: NVIDIA Nemotron through the OpenAI-compatible
 * chat completions API. Plain `fetch`, no SDK.
 *
 * Primary model first, fallback model if it fails; both failures throw and
 * the route answers with an honest error instead of an invented reply.
 *
 * ENV: NEBIUS_API_KEY, NEBIUS_MODEL, NEBIUS_MODEL_FALLBACK, NEBIUS_API_URL
 */

'use strict';

const DEFAULT_URL = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const DEFAULT_FALLBACK = 'nvidia/nvidia-nemotron-3-nano-30b-a3b';

function config() {
  return {
    url: (process.env.NEBIUS_API_URL || DEFAULT_URL).trim(),
    key: (process.env.NEBIUS_API_KEY || '').trim(),
    model: (process.env.NEBIUS_MODEL || DEFAULT_MODEL).trim(),
    fallback: (process.env.NEBIUS_MODEL_FALLBACK || DEFAULT_FALLBACK).trim()
  };
}

function isConfigured() { return Boolean(config().key); }

async function completeOnce({ model, messages, temperature, max_tokens, json, fetchImpl }) {
  const { url, key } = config();
  if (!key) throw new Error('NEBIUS_API_KEY not configured');
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const body = { model, messages, temperature, max_tokens };
  if (json) body.response_format = { type: 'json_object' };

  const resp = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Nebius HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  return { content: String(content || ''), model, usage: data.usage || null };
}

/**
 * @returns {{content: string, model: string, usage: object|null}}
 */
async function chat({ messages, temperature = 0.6, max_tokens = 700, json = true, fetchImpl }) {
  const { model, fallback } = config();
  try {
    return await completeOnce({ model, messages, temperature, max_tokens, json, fetchImpl });
  } catch (e) {
    console.warn('[nebius]', model, 'failed:', e.message, '| trying', fallback);
    return completeOnce({ model: fallback, messages, temperature, max_tokens, json, fetchImpl });
  }
}

module.exports = { chat, isConfigured, config };
