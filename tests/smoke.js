'use strict';
// End-to-end API smoke test in demo mode. Run: npm test
delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET; delete process.env.ANTHROPIC_API_KEY;
process.env.PAYPAL_CLIENT_ID = ''; process.env.PAYPAL_CLIENT_SECRET = ''; process.env.ANTHROPIC_API_KEY = '';
process.env.FASHEATE_STORE = require('path').join(require('os').tmpdir(), 'fasheate-test-' + Date.now() + '.json');
const assert = require('assert');
const { createServer } = require('../server');

(async () => {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  const call = async (p, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  try {
    let r = await call('/api/config'); assert.equal(r.status, 200);

    r = await call('/api/analyze', 'POST', { notes: 'A flowy summer dress with sunflowers', colors: ['#f6d743'] });
    assert.equal(r.json.category, 'dress'); assert(r.json.materials.length && r.json.maker_skills.length);

    r = await call('/api/makers?skills=tailoring,pattern-making');
    assert.equal(r.json[0].id, 'm1'); assert.equal(r.json[0].match, 100);

    r = await call('/api/commissions', 'POST', { makerId: 'm1', title: 'Sunflower dress', price: 333.33 });
    assert.equal(r.status, 201);
    const c = r.json; const sum = c.payments.reduce((s, p) => s + p.cents, 0);
    assert.equal(sum, 33333, 'payment plan must sum exactly to total');

    // cannot skip stages
    r = await call(`/api/commissions/${c.id}/pay/milestone/order`, 'POST'); assert.equal(r.status, 409);

    for (const key of ['deposit', 'milestone', 'final']) {
      const o = await call(`/api/commissions/${c.id}/pay/${key}/order`, 'POST'); assert.equal(o.status, 200);
      const bad = await call(`/api/commissions/${c.id}/pay/${key}/capture`, 'POST', { orderID: 'WRONG' }); assert.equal(bad.status, 400);
      const cap = await call(`/api/commissions/${c.id}/pay/${key}/capture`, 'POST', { orderID: o.json.id }); assert.equal(cap.status, 200);
    }
    r = await call(`/api/commissions/${c.id}`); assert(r.json.payments.every((p) => p.status === 'paid'));
    r = await call(`/api/commissions/${c.id}/pay/final/order`, 'POST'); assert.equal(r.status, 409);

    r = await call('/api/makers?skills=x'); assert.equal(r.status, 200);
    console.log('All smoke tests passed ✔');
  } finally { srv.close(); }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
