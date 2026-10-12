/**
 * The two network clients, without a network: the core gets the bearer key
 * and the action; Nebius gets an OpenAI-shaped body and falls back to the
 * second model when the first one fails. The system prompt lists every
 * catalog item with its exact price.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const core = require('../src/core-client');
const nebius = require('../src/nebius-client');
const { buildSystemPrompt } = require('../src/system-prompt');

const saved = {};
beforeEach(() => {
  for (const k of ['CORE_API_URL', 'CORE_API_KEY', 'NEBIUS_API_KEY', 'NEBIUS_MODEL', 'NEBIUS_MODEL_FALLBACK']) {
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
    const r = await core.checkout('a@b.co', 'plan', 'guardian_1m', async (url, opts) => {
      seen = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      return jsonResp(200, { approve_url: 'https://paypal/approve', order_id: 'O1' });
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(seen.url, 'https://core.test/api/concierge');
    assert.strictEqual(seen.headers.Authorization, 'Bearer k-1');
    assert.deepStrictEqual(seen.body, { action: 'checkout', email: 'a@b.co', kind: 'plan', key: 'guardian_1m' });
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

describe('nebius-client', () => {
  test('without a key → throws before any network call', async () => {
    let called = false;
    await assert.rejects(() => nebius.chat({ messages: [], fetchImpl: async () => { called = true; } }), /NEBIUS_API_KEY/);
    assert.strictEqual(called, false);
  });

  test('OpenAI-shaped body, JSON mode, bearer header', async () => {
    process.env.NEBIUS_API_KEY = 'nb';
    let seen = null;
    const out = await nebius.chat({
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: async (url, opts) => {
        seen = { url, headers: opts.headers, body: JSON.parse(opts.body) };
        return jsonResp(200, { choices: [{ message: { content: '{"reply":"hello","recommend":null}' } }], usage: { total_tokens: 5 } });
      }
    });
    assert.match(seen.url, /tokenfactory\.nebius\.com/);
    assert.strictEqual(seen.headers.Authorization, 'Bearer nb');
    assert.strictEqual(seen.body.model, 'nvidia/nemotron-3-super-120b-a12b');
    assert.deepStrictEqual(seen.body.response_format, { type: 'json_object' });
    assert.strictEqual(out.content, '{"reply":"hello","recommend":null}');
    assert.strictEqual(out.model, 'nvidia/nemotron-3-super-120b-a12b');
  });

  test('primary fails → fallback model answers', async () => {
    process.env.NEBIUS_API_KEY = 'nb';
    const models = [];
    const out = await nebius.chat({
      messages: [],
      fetchImpl: async (url, opts) => {
        const m = JSON.parse(opts.body).model;
        models.push(m);
        if (m.includes('super')) return jsonResp(503, { error: 'busy' });
        return jsonResp(200, { choices: [{ message: { content: 'ok' } }] });
      }
    });
    assert.deepStrictEqual(models, ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nvidia-nemotron-3-nano-30b-a3b']);
    assert.strictEqual(out.model, 'nvidia/nvidia-nemotron-3-nano-30b-a3b');
  });

  test('both fail → throws', async () => {
    process.env.NEBIUS_API_KEY = 'nb';
    await assert.rejects(() => nebius.chat({ messages: [], fetchImpl: async () => jsonResp(500, {}) }), /Nebius HTTP 500/);
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
