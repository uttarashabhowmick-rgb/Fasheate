'use strict';
// Run with: npm test   (uses demo mode: no external API calls)
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.FASHEATE_DB = require('node:path').join(require('node:os').tmpdir(), `fe-test-${process.pid}.json`);

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let server, base;
test.before(async () => { server = createServer(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('serves the app and config', async () => {
  assert.match(await (await fetch(base + '/')).text(), /Fasheate/);
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.paymentMode, 'demo');
});

test('blocks path traversal', async () => {
  const r = await fetch(base + '/..%2fserver.js');
  assert.ok([403, 404].includes(r.status));
});

test('analyze returns a structured brief', async () => {
  const r = await post('/api/analyze', { image: PNG, title: 'Market tote', notes: 'a bright bag', meta: { template: 'bag', elements: ['star motif'], colors: ['#e4472b'] } });
  const { brief } = await r.json();
  assert.equal(brief.category, 'bag');
  assert.ok(brief.materials.length && brief.construction.length && brief.questions.length);
});

test('rejects non-image analyze input', async () => {
  assert.equal((await post('/api/analyze', { image: 'nope' })).status, 400);
});

test('commission + ordered payments', async () => {
  const { brief } = await (await post('/api/analyze', { image: PNG, title: 'Jacket', notes: '', meta: { template: 'jacket', elements: [], colors: [] } })).json();
  const { makers } = await (await fetch(`${base}/api/makers?category=jacket&tags=denim,patchwork`)).json();
  assert.equal(makers[0].id, 'm3'); // best denim/patchwork match
  const c = await (await post('/api/commissions', { makerId: makers[0].id, title: 'Jacket', design: PNG, brief })).json();
  assert.equal(c.payments.length, 3);
  assert.equal(c.payments.reduce((s, p) => s + p.amount, 0), c.total);

  // cannot pay milestone 2 before the deposit
  assert.equal((await post(`/api/commissions/${c.id}/payments/p2/order`, {})).status, 409);

  for (const p of c.payments) {
    const { id } = await (await post(`/api/commissions/${c.id}/payments/${p.id}/order`, {})).json();
    // capture must present the matching order id
    assert.equal((await post(`/api/commissions/${c.id}/payments/${p.id}/capture`, { orderId: 'WRONG' })).status, 400);
    const done = await (await post(`/api/commissions/${c.id}/payments/${p.id}/capture`, { orderId: id })).json();
    assert.equal(done.payments.find((x) => x.id === p.id).status, 'paid');
  }
  const final = await (await fetch(`${base}/api/commissions/${c.id}`)).json();
  assert.equal(final.status, 'complete');
});

test('photo preview: demo mode without a Gemini key', async () => {
  const r = await post('/api/photo', { image: PNG, view: 'front' });
  assert.equal((await r.json()).mode, 'demo');
  assert.equal((await post('/api/photo', { image: 'bad' })).status, 400);
});

test('photo preview: parses a Gemini image reply (mocked API)', async () => {
  const http = require('node:http');
  let seen;
  const mock = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      seen = { url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(body) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: PNG.split(',')[1] } }] } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.GEMINI_API_KEY = 'test-key'; process.env.GEMINI_API_BASE = `http://127.0.0.1:${mock.address().port}`;
  try {
    const out = await (await post('/api/photo', { image: PNG, view: 'angle', title: 'Jacket', category: 'jacket', fabric: 'denim', parts: ['Body: #4f6d94'], palette: ['#4f6d94'] })).json();
    assert.equal(out.mode, 'ai'); assert.equal(out.image, PNG);
    assert.match(seen.url, /gemini-2\.5-flash-image:generateContent/);
    assert.equal(seen.key, 'test-key');
    assert.match(seen.body.contents[0].parts[0].text, /THREE-QUARTER/);
    assert.ok(seen.body.contents[0].parts[1].inline_data.data);
  } finally { delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_BASE; mock.close(); }
});

test('products: demo mode (no Channel3 key) gives shop-search links', async () => {
  const out = await (await post('/api/products', { materials: [{ name: 'Black denim fabric', reason: 'Main body', search: 'black denim fabric' }] })).json();
  assert.equal(out.mode, 'demo');
  assert.match(out.groups[0].shopUrl, /^https:\/\/www\.google\.com\/search\?tbm=shop&q=black%20denim%20fabric/);
  assert.deepEqual(out.groups[0].products, []);
});

test('products + Stability photo: parse mocked Channel3 and Stability replies', async () => {
  const http = require('node:http'); const seen = {};
  const mock = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const raw = Buffer.concat(chunks); res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/search') {
        seen.c3 = { key: req.headers['x-api-key'], body: JSON.parse(raw.toString()) };
        return res.end(JSON.stringify({ products: [{ id: 'prod_1', title: 'Black Stretch Denim 10oz', brand_name: 'Fabric Co', images: [{ url: 'https://img.example/a.jpg' }], offers: [{ url: 'https://shop.example/denim', domain: 'shop.example', price: { price: 12.5, currency: 'USD' }, availability: 'InStock' }] }, { id: 'x', title: 'Bad link', offers: [{ url: 'javascript:alert(1)' }] }] }));
      }
      if (req.url.startsWith('/v2beta/stable-image/control/')) {
        seen.st = { auth: req.headers.authorization, accept: req.headers.accept, type: req.headers['content-type'], body: raw.toString('latin1') };
        return res.end(JSON.stringify({ image: PNG.split(',')[1], finish_reason: 'SUCCESS', seed: 1 }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const b = `http://127.0.0.1:${mock.address().port}`;
  Object.assign(process.env, { CHANNEL3_API_KEY: 'c3-key', CHANNEL3_API_BASE: b, STABILITY_API_KEY: 'st-key', STABILITY_API_BASE: b });
  try {
    const out = await (await post('/api/products', { materials: [{ name: 'Black denim', reason: 'body', search: 'black denim fabric' }] })).json();
    assert.equal(out.mode, 'live'); assert.equal(seen.c3.key, 'c3-key'); assert.equal(seen.c3.body.query, 'black denim fabric');
    const g = out.groups[0]; assert.equal(g.products.length, 1); // the javascript: link is dropped
    assert.equal(g.products[0].url, 'https://shop.example/denim'); assert.equal(g.products[0].price, 12.5);

    const ph = await (await post('/api/photo', { image: PNG, view: 'front', title: 'Jacket', category: 'jacket', fabric: 'denim', parts: ['Body: #000000'] })).json();
    assert.equal(ph.mode, 'ai'); assert.equal(ph.provider, 'stability'); assert.ok(ph.image.startsWith('data:image/'));
    assert.equal(seen.st.auth, 'Bearer st-key'); assert.equal(seen.st.accept, 'application/json'); assert.match(seen.st.type, /multipart\/form-data/);
    assert.match(seen.st.body, /name="prompt"/); assert.match(seen.st.body, /name="control_strength"/);
  } finally { for (const k of ['CHANNEL3_API_KEY', 'CHANNEL3_API_BASE', 'STABILITY_API_KEY', 'STABILITY_API_BASE']) delete process.env[k]; mock.close(); }
});
