/**
 * The two network clients, without a network: the core gets the bearer key
 * and the action; the model client sends an OpenAI-shaped body and falls back to the
 * second model when the first one fails. The system prompt lists every
 * catalog item with its exact price.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const core = require('../src/core-client');
const llm = require('../src/llm-client');
const { buildSystemPrompt } = require('../src/system-prompt');

const saved = {};
beforeEach(() => {
  for (const k of ['CORE_API_URL', 'CORE_API_KEY', 'LLM_API_KEY', 'LLM_API_URL', 'LLM_MODEL', 'LLM_MODEL_FALLBACK']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const jsonResp = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

describe('core-client', () => {
  test('not configured → 503 without a network call', async () => {
    let called = false;
    const r = await core.profile('1990-01-01', async () => { called = true; });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 503);
    assert.strictEqual(called, false);
  });

  test('sends bearer key, action and payload to CORE_API_URL', async () => {
    process.env.CORE_API_URL = 'https://core.test/api/concierge';
    process.env.CORE_API_KEY = 'k-1';
    let seen = null;
    const r = await core.checkout('a@b.co', 'plan', 'guardian_1m', '10.09.1977', async (url, opts) => {
      seen = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      return jsonResp(200, { approve_url: 'https://paypal/approve', order_id: 'O1' });
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(seen.url, 'https://core.test/api/concierge');
    assert.strictEqual(seen.headers.Authorization, 'Bearer k-1');
    assert.deepStrictEqual(seen.body, { action: 'checkout', email: 'a@b.co', kind: 'plan', key: 'guardian_1m', birth_date: '10.09.1977' });
    assert.strictEqual(r.data.order_id, 'O1');
  });

  test('core error → status and message pass through', async () => {
    process.env.CORE_API_URL = 'https://core.test/x';
    process.env.CORE_API_KEY = 'k';
    const r = await core.status('a@b.co', async () => jsonResp(409, { error: 'book already purchased' }));
    assert.deepStrictEqual(r, { ok: false, status: 409, error: 'book already purchased' });
  });

  test('network failure → 502, not a throw', async () => {
    process.env.CORE_API_URL = 'https://core.test/x';
    process.env.CORE_API_KEY = 'k';
    const r = await core.status('a@b.co', async () => { throw new Error('ECONNREFUSED'); });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 502);
  });
});

describe('llm-client', () => {
  test('without a key → throws before any network call', async () => {
    delete process.env.LLM_API_KEY;
    let called = false;
    await assert.rejects(() => llm.chat({ messages: [], fetchImpl: async () => { called = true; } }), /LLM_API_KEY/);
    assert.strictEqual(called, false);
  });

  test('OpenAI-shaped body, JSON mode, bearer header; DeepSeek by default', async () => {
    process.env.LLM_API_KEY = 'k1';
    delete process.env.LLM_API_URL; delete process.env.LLM_MODEL; delete process.env.LLM_MODEL_FALLBACK;
    let seen = null;
    const out = await llm.chat({
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: async (url, opts) => {
        seen = { url, headers: opts.headers, body: JSON.parse(opts.body) };
        return jsonResp(200, { choices: [{ message: { content: '{"reply":"hello","recommend":null}' } }], usage: { total_tokens: 5 } });
      }
    });
    assert.match(seen.url, /api\.deepseek\.com/);
    assert.strictEqual(seen.headers.Authorization, 'Bearer k1');
    assert.strictEqual(seen.body.model, 'deepseek-chat');
    assert.deepStrictEqual(seen.body.response_format, { type: 'json_object' });
    assert.strictEqual(out.content, '{"reply":"hello","recommend":null}');
  });

  test('another provider by env: URL and models come from LLM_*', async () => {
    process.env.LLM_API_KEY = 'k2';
    process.env.LLM_API_URL = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
    process.env.LLM_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
    process.env.LLM_MODEL_FALLBACK = 'nvidia/nvidia-nemotron-3-nano-30b-a3b';
    const models = [];
    const out = await llm.chat({
      messages: [],
      fetchImpl: async (url, opts) => {
        assert.match(url, /tokenfactory\.nebius\.com/);
        const m = JSON.parse(opts.body).model;
        models.push(m);
        if (m.includes('super')) return jsonResp(503, { error: 'busy' });
        return jsonResp(200, { choices: [{ message: { content: 'ok' } }] });
      }
    });
    assert.deepStrictEqual(models, ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nvidia-nemotron-3-nano-30b-a3b']);
    assert.strictEqual(out.model, 'nvidia/nvidia-nemotron-3-nano-30b-a3b');
  });

  test('no fallback configured → the first failure throws, no second call', async () => {
    process.env.LLM_API_KEY = 'k3';
    delete process.env.LLM_API_URL; delete process.env.LLM_MODEL; delete process.env.LLM_MODEL_FALLBACK;
    let calls = 0;
    await assert.rejects(() => llm.chat({ messages: [], fetchImpl: async () => { calls++; return jsonResp(500, {}); } }), /LLM HTTP 500/);
    assert.strictEqual(calls, 1);
  });
});

describe('system prompt', () => {
  test('lists every catalog item with kind, key and price; carries the Gift', () => {
    const profile = {
      dar_code: '5-5-1', name_ru: 'ТЕ-ЛО', metaphor_ru: 'Храм души', essence_en: 'Balance.',
      light_en: 'L', shadow_en: 'S', energy_flow_ru: 'E', warning_ru: 'W',
      catalog: {
        book: { key: 'book', name: 'The Book', description: 'All chapters.', usd: 8.76 },
        plans: [{ key: 'guardian_1m', name: 'Guardian · 1 month', description: 'd', features: ['f1'], usd: 5.73, promo_usd: 2.87 }],
        addons: [{ key: 'oracle_unlimited_7d', name: 'Oracle', description: 'd', duration: '7 days', usd: 1.74 }]
      }
    };
    const p = buildSystemPrompt(profile);
    assert.match(p, /kind=book key=book — The Book: All chapters\. Price \$8\.76\./);
    assert.match(p, /kind=plan key=guardian_1m — Guardian · 1 month: d Price \$5\.73\. First month with -50% promo: \$2\.87\./);
    assert.match(p, /kind=addon key=oracle_unlimited_7d — Oracle: d \(7 days\)\. Price \$1\.74\./);
    assert.match(p, /Code: 5-5-1/);
    assert.match(p, /"recommend": \{"kind": "book\|plan\|addon"/);
  });
});
