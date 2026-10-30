'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { limit, visitorIp, reset } = require('../src/rate-limit');

function run(mw, ip, xff) {
  const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, json() { return this; }, setHeader(k, v) { this.headers[k] = v; } };
  let passed = false;
  mw({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: ip } }, res, () => { passed = true; });
  return passed ? 200 : res.code;
}

beforeEach(() => reset());

test('the n+1-th request from one visitor in the window gets 429, others are not affected', () => {
  const mw = limit('start', 3, 60000);
  assert.deepStrictEqual([1, 2, 3, 4].map(() => run(mw, '1.1.1.1')), [200, 200, 200, 429]);
  assert.strictEqual(run(mw, '2.2.2.2'), 200, 'one noisy visitor locked out another one');
});

test('the visitor is the LAST X-Forwarded-For entry — the first one the client can fake', () => {
  assert.strictEqual(visitorIp({ headers: { 'x-forwarded-for': '9.9.9.9, 5.5.5.5' }, socket: {} }), '5.5.5.5');
  const mw = limit('start', 1, 60000);
  assert.strictEqual(run(mw, 'proxy', 'fake-1, 5.5.5.5'), 200);
  assert.strictEqual(run(mw, 'proxy', 'fake-2, 5.5.5.5'), 429, 'a new fake first entry bypassed the limit');
});
