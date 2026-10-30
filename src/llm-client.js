/**
 * Language-model client: any OpenAI-compatible chat completions API
 * (DeepSeek by default; Nebius Token Factory, OpenAI and others work the same
 * way by changing LLM_API_URL and LLM_MODEL). Plain `fetch`, no SDK.
 *
 * Primary model first, optional fallback model if it fails; both failures
 * throw and the route answers with an honest error instead of an invented reply.
 *
 * ENV: LLM_API_KEY, LLM_API_URL, LLM_MODEL, LLM_MODEL_FALLBACK
 */

'use strict';

const DEFAULT_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

function config() {
  return {
    url: (process.env.LLM_API_URL || DEFAULT_URL).trim(),
    key: (process.env.LLM_API_KEY || '').trim(),
    model: (process.env.LLM_MODEL || DEFAULT_MODEL).trim(),
    fallback: (process.env.LLM_MODEL_FALLBACK || '').trim()
  };
}

function isConfigured() { return Boolean(config().key); }

async function completeOnce({ model, messages, temperature, max_tokens, json, fetchImpl }) {
  const { url, key } = config();
  if (!key) throw new Error('LLM_API_KEY not configured');
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
    throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
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
    if (!fallback || fallback === model) throw e;
    console.warn('[llm]', model, 'failed:', e.message, '| trying', fallback);
    return completeOnce({ model: fallback, messages, temperature, max_tokens, json, fetchImpl });
  }
}

module.exports = { chat, isConfigured, config };
