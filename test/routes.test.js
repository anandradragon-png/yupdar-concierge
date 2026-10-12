/**
 * The contract between the model and the page: strict JSON in, a safe
 * recommendation out. A key the catalog does not have is dropped, prose
 * around the JSON is tolerated, garbage keeps the text and drops the offer.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseReply, catalogHas } = require('../src/routes');

const catalog = {
  book: { key: 'book', name: 'The Book', usd: 8.76 },
  plans: [{ key: 'guardian_1m', usd: 5.73 }, { key: 'master_12m', usd: 40 }],
  addons: [{ key: 'oracle_unlimited_7d', usd: 1.74 }]
};

describe('parseReply', () => {
  test('clean JSON with a valid plan → reply and priced recommendation', () => {
    const r = parseReply('{"reply":"Try Guardian.","recommend":{"kind":"plan","key":"guardian_1m"}}', catalog);
    assert.strictEqual(r.reply, 'Try Guardian.');
    assert.deepStrictEqual(r.recommend, { kind: 'plan', key: 'guardian_1m', usd: 5.73 });
  });

  test('book recommendation carries the book price', () => {
    const r = parseReply('{"reply":"The Book.","recommend":{"kind":"book","key":"book"}}', catalog);
    assert.deepStrictEqual(r.recommend, { kind: 'book', key: 'book', usd: 8.76 });
  });

  test('null recommendation stays null', () => {
    const r = parseReply('{"reply":"Tell me more.","recommend":null}', catalog);
    assert.strictEqual(r.recommend, null);
  });

  test('invented key is dropped — the model cannot sell what does not exist', () => {
    const r = parseReply('{"reply":"Buy X.","recommend":{"kind":"plan","key":"platinum_99m"}}', catalog);
    assert.strictEqual(r.recommend, null);
    assert.strictEqual(r.reply, 'Buy X.');
  });

  test('wrong kind for a real key is dropped', () => {
    const r = parseReply('{"reply":"x","recommend":{"kind":"addon","key":"guardian_1m"}}', catalog);
    assert.strictEqual(r.recommend, null);
  });

  test('JSON wrapped in prose is still parsed', () => {
    const r = parseReply('Sure! {"reply":"Hi","recommend":null} Hope this helps.', catalog);
    assert.strictEqual(r.reply, 'Hi');
  });

  test('plain prose → reply is the prose, no offer', () => {
    const r = parseReply('I am not JSON today.', catalog);
    assert.strictEqual(r.reply, 'I am not JSON today.');
    assert.strictEqual(r.recommend, null);
  });

  test('empty → placeholder, no crash', () => {
    const r = parseReply('', catalog);
    assert.strictEqual(r.recommend, null);
    assert.ok(r.reply.length > 0);
  });
});

describe('catalogHas', () => {
  test('accepts only catalog keys of the right kind', () => {
    assert.strictEqual(catalogHas(catalog, { kind: 'book', key: 'book' }), true);
    assert.strictEqual(catalogHas(catalog, { kind: 'book', key: 'guardian_1m' }), false);
    assert.strictEqual(catalogHas(catalog, { kind: 'addon', key: 'oracle_unlimited_7d' }), true);
    assert.strictEqual(catalogHas(catalog, { kind: 'subscription', key: 'master_12m' }), false);
    assert.strictEqual(catalogHas(catalog, null), false);
    assert.strictEqual(catalogHas(catalog, 'book'), false);
  });
});
