'use strict';
/* Fasheate front-end — vanilla JS, no build step. All server text is rendered via textContent. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); };
async function api(path, opts) {
  const r = await fetch(path, opts && opts.body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/* ---------------- state + navigation ---------------- */
const state = { products: [], photos: {}, curView: 'front', config: null, design: null, brief: null, meta: { template: '', elements: new Set(), colors: [] }, commission: null, answers: '' };

const VIEWS = ['home', 'studio', 'brief', 'makers', 'commission'];
function show(view) {
  if (!VIEWS.includes(view)) view = 'home';
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === view));
  $$('.step').forEach((s) => s.classList.toggle('on', s.dataset.go === view));
  const order = ['studio', 'brief', 'makers', 'commission'];
  const reached = { studio: true, brief: !!state.brief, makers: !!state.brief, commission: !!state.commission };
  $$('.step').forEach((s) => s.classList.toggle('done', order.indexOf(s.dataset.go) < order.indexOf(view) && reached[s.dataset.go]));
  document.body.classList.toggle('is-home', view === 'home');
  const v = $('#demo'); if (v) { if (view === 'home') v.play().catch(() => {}); else v.pause(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function go(view) { if (location.hash === '#' + view) show(view); else location.hash = view; }
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { e.preventDefault(); go(b.dataset.go); } });

/* ---------------- studio: realistic garment canvas ---------------- */
const canvas = $('#canvas'), ctx = canvas.getContext('2d');
const W = canvas.width, GS = Garments.S;
const paint = document.createElement('canvas'); paint.width = paint.height = W;
const pctx = paint.getContext('2d', { willReadFrequently: true });
const SWATCHES = ['#1b1713', '#e4472b', '#e8b04a', '#5f8a6a', '#2f6db5', '#3d2b56', '#e58fb0', '#8a5a3c', '#ffffff', '#9aa0a6', '#f2c9a0', '#0e7c7b'];
let tool = 'brush', color = '#e4472b', size = 8, stamp = 'star', drawing = false, last = null;
let model = null;                                   // current garment (Garments.build result) or null
const look = { fabric: 'cotton', colors: {}, mirror: true };
const undoStack = [];

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(model ? model.stage : Garments.blankStage(), 0, 0);
  if (model) {
    ctx.save(); ctx.scale(GS, GS); ctx.lineJoin = 'round'; ctx.lineWidth = .3;
    for (const p of model.panels) { const c = look.colors[p.id] || p.color; ctx.fillStyle = ctx.strokeStyle = c; ctx.fill(p.path); ctx.stroke(p.path); }
    ctx.restore();
  }
  ctx.drawImage(paint, 0, 0);
  if (model) ctx.drawImage(model.shade, 0, 0);
}
let raf = 0; const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

function setModel(key, fabric) {
  model = key ? Garments.build(key, fabric) : null;
  look.fabric = model ? model.fabric : look.fabric;
  syncPanel();
}
function snapshot() { undoStack.push({ paint: pctx.getImageData(0, 0, W, W), colors: { ...look.colors }, key: model ? model.key : '', fabric: look.fabric, template: state.meta.template }); if (undoStack.length > 25) undoStack.shift(); }
function restore(sn) { pctx.putImageData(sn.paint, 0, 0); look.colors = { ...sn.colors }; state.meta.template = sn.template; setModel(sn.key, sn.fabric); render(); }

function drawTemplate(key) {
  snapshot(); pctx.clearRect(0, 0, W, W);
  look.colors = Garments.defaults(key); look.fabric = Garments.defaultFabric(key);
  setModel(key, look.fabric); render();
  state.meta.template = key; state.meta.elements.add(`${Garments.label(key)} template`);
  toast('Tap any part of the garment with the Fill tool to colour it.');
  setTool('fill');
}
function pos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (W / r.height) }; }
function hitPanel(x, y) {
  if (!model) return null; let hit = null;
  ctx.save(); ctx.setTransform(GS, 0, 0, GS, 0, 0);
  for (let i = model.panels.length - 1; i >= 0 && !hit; i--) if (ctx.isPointInPath(model.panels[i].path, x, y)) hit = model.panels[i];
  ctx.restore(); return hit;
}
function colourPart(hit, c) {
  const ids = look.mirror ? model.panels.filter((q) => q.group === hit.group).map((q) => q.id) : [hit.id];
  ids.forEach((id) => { look.colors[id] = c; });
  state.meta.elements.add('recoloured parts');
  render(); toast(`${look.mirror ? hit.label : hit.name} → ${c}`);
}

function drawShape(g, kind, x, y, s, c) {
  g.save(); g.globalCompositeOperation = 'source-over';
  g.fillStyle = c; g.strokeStyle = c; g.lineWidth = Math.max(2, s / 8); g.lineJoin = g.lineCap = 'round'; g.beginPath();
  const r = s * 1.6;
  if (kind === 'circle') g.arc(x, y, r, 0, 7), g.fill();
  else if (kind === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); }
  else if (kind === 'heart') { g.moveTo(x, y + r * .8); g.bezierCurveTo(x - r * 1.5, y - r * .2, x - r * .6, y - r * 1.1, x, y - r * .35); g.bezierCurveTo(x + r * .6, y - r * 1.1, x + r * 1.5, y - r * .2, x, y + r * .8); g.fill(); }
  else if (kind === 'zigzag') { for (let i = -3; i <= 3; i++) g[i === -3 ? 'moveTo' : 'lineTo'](x + i * r * .45, y + (i % 2 ? -r * .4 : r * .4)); g.stroke(); }
  else if (kind === 'stripes') { for (let i = -2; i <= 2; i++) { g.moveTo(x + i * r * .5, y - r); g.lineTo(x + i * r * .5, y + r); } g.stroke(); }
  else if (kind === 'flower') { for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(x + Math.cos(i * 1.047) * r * .6, y + Math.sin(i * 1.047) * r * .6, r * .4, r * .4, 0, 0, 7); g.fill(); } g.fillStyle = '#e8b04a'; g.beginPath(); g.arc(x, y, r * .28, 0, 7); g.fill(); }
  g.restore();
}

/* flood fill on the paint layer (for closed shapes you draw yourself, when no garment is loaded) */
function floodFill(sx, sy, hex) {
  const img = pctx.getImageData(0, 0, W, W), d = img.data, x0 = Math.floor(sx), y0 = Math.floor(sy);
  const i0 = (y0 * W + x0) * 4, t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const n = parseInt(hex.slice(1), 16), fr = n >> 16, fg = (n >> 8) & 255, fb = n & 255;
  if (t[3] === 255 && t[0] === fr && t[1] === fg && t[2] === fb) return;
  const near = (i) => Math.abs(d[i] - t[0]) + Math.abs(d[i + 1] - t[1]) + Math.abs(d[i + 2] - t[2]) + Math.abs(d[i + 3] - t[3]) < 60;
  const stack = [x0, y0];
  while (stack.length) {
    let y = stack.pop(), x = stack.pop();
    while (x >= 0 && near((y * W + x) * 4)) x--;
    x++; let up = false, dn = false;
    while (x < W && near((y * W + x) * 4)) {
      const i = (y * W + x) * 4; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
      if (y > 0) { const u = near(((y - 1) * W + x) * 4); if (u && !up) stack.push(x, y - 1); up = u; }
      if (y < W - 1) { const v = near(((y + 1) * W + x) * 4); if (v && !dn) stack.push(x, y + 1); dn = v; }
      x++;
    }
  }
  pctx.putImageData(img, 0, 0);
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault(); canvas.setPointerCapture(e.pointerId);
  const p = pos(e); snapshot();
  if (tool === 'fill') {
    const hit = hitPanel(p.x, p.y);
    if (hit) colourPart(hit, color);
    else if (!model) { floodFill(p.x, p.y, color); state.meta.elements.add('colour fills'); render(); }
    else { undoStack.pop(); toast('Tap a garment part to colour it.'); }
    return;
  }
  if (tool === 'stamp') { drawShape(pctx, stamp, p.x, p.y, size, color); state.meta.elements.add(`${stamp} motif`); render(); return; }
  drawing = true; last = p;
  pctx.save(); pctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; pctx.fillStyle = color;
  pctx.beginPath(); pctx.arc(p.x, p.y, size / 2, 0, 7); pctx.fill(); pctx.restore(); schedule();
  if (tool === 'brush') state.meta.elements.add('freehand lines');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return; const p = pos(e);
  pctx.save(); pctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  pctx.strokeStyle = color; pctx.lineWidth = size; pctx.lineCap = pctx.lineJoin = 'round';
  pctx.beginPath(); pctx.moveTo(last.x, last.y); pctx.lineTo(p.x, p.y); pctx.stroke(); pctx.restore(); last = p; schedule();
});
['pointerup', 'pointercancel'].forEach((t) => canvas.addEventListener(t, () => { drawing = false; }));

/* toolbar wiring */
Garments.order.forEach((k) => $('#templates').append(h('button', { class: 'chip', 'data-tpl': k, text: Garments.label(k), onclick: () => drawTemplate(k) })));
Garments.FABRICS.forEach(([k, name]) => $('#fabrics').append(h('button', { class: 'chip', 'data-fab': k, text: name, onclick: () => {
  if (!model) return toast('Pick a garment first, then choose its fabric.');
  snapshot(); look.fabric = k; setModel(model.key, k); render(); state.meta.elements.add(`${name.toLowerCase()} fabric`);
} })));
function syncPanel() {
  $$('#templates .chip').forEach((b) => b.classList.toggle('on', !!model && b.dataset.tpl === model.key));
  $$('#fabrics .chip').forEach((b) => b.classList.toggle('on', !!model && b.dataset.fab === look.fabric));
  $('#fabrics').classList.toggle('off', !model);
}
$('#mirror').addEventListener('change', (e) => { look.mirror = e.target.checked; });
SWATCHES.forEach((c) => $('#swatches').append(h('button', { class: 'sw' + (c === color ? ' on' : ''), 'data-c': c, style: `background:${c}`, 'aria-label': `Colour ${c}`, onclick: () => setColor(c) })));
function setColor(c) { color = c; $('#color').value = c; $$('.sw').forEach((s) => s.classList.toggle('on', s.dataset.c === c)); if (tool === 'eraser') setTool('brush'); }
$('#color').addEventListener('input', (e) => setColor(e.target.value));
function setTool(t) { tool = t; $$('#toolbtns .chip').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); $('#stamps').hidden = t !== 'stamp'; canvas.style.cursor = t === 'fill' ? 'cell' : 'crosshair'; }
$$('#toolbtns .chip').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
['star', 'heart', 'circle', 'flower', 'zigzag', 'stripes'].forEach((s) => $('#stamps').append(h('button', { class: 'chip' + (s === stamp ? ' on' : ''), text: s, onclick: (e) => { stamp = s; $$('#stamps .chip').forEach((c) => c.classList.toggle('on', c === e.target)); } })));
$('#size').addEventListener('input', (e) => { size = +e.target.value; $('#sizeout').textContent = size; });
$('#undo').addEventListener('click', () => { const sn = undoStack.pop(); if (sn) restore(sn); });
$('#clear').addEventListener('click', () => { snapshot(); pctx.clearRect(0, 0, W, W); look.colors = {}; state.meta.elements.clear(); state.meta.template = ''; setModel('', look.fabric); render(); });
$('#savepng').addEventListener('click', () => { const a = h('a', { href: canvas.toDataURL('image/png'), download: 'fasheate-design.png' }); a.click(); });
$('#upload').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image(); img.onload = () => {
    snapshot(); pctx.clearRect(0, 0, W, W); look.colors = {}; state.meta.template = ''; setModel('', look.fabric);
    const k = Math.min(W / img.width, W / img.height); const w = img.width * k, hh = img.height * k;
    pctx.drawImage(img, (W - w) / 2, (W - hh) / 2, w, hh); state.meta.elements.add('uploaded reference image'); URL.revokeObjectURL(img.src); render();
  };
  img.src = URL.createObjectURL(f); e.target.value = '';
});

function isBlank() { if (model) return false; const d = pctx.getImageData(0, 0, W, W).data; for (let i = 3; i < d.length; i += 4 * 61) if (d[i] > 10) return false; return true; }
function dominantColors() {
  const out = [];
  if (model) for (const p of model.panels) { const c = look.colors[p.id] || p.color; if (!out.includes(c)) out.push(c); }
  const t = document.createElement('canvas'); t.width = t.height = 60; const c = t.getContext('2d'); c.drawImage(paint, 0, 0, 60, 60);
  const d = c.getImageData(0, 0, 60, 60).data, bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5), o = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 }; o.n++; o.r += r; o.g += g; o.b += b; bins.set(key, o);
  }
  [...bins.values()].sort((a, b) => b.n - a.n).slice(0, 4).filter((o) => o.n > 12)
    .forEach((o) => { const hx = '#' + [o.r, o.g, o.b].map((v) => Math.round(v / o.n).toString(16).padStart(2, '0')).join(''); if (!out.includes(hx)) out.push(hx); });
  return out.slice(0, 6);
}
function partsSummary() { return model ? model.panels.filter((p, i, a) => a.findIndex((q) => q.group === p.group) === i).map((p) => `${p.label}: ${look.colors[p.id] || p.color}`).slice(0, 10) : []; }
function resetCanvas() { setModel('', 'cotton'); render(); }

/* ---------------- step 2: AI brief ---------------- */
async function develop(refine = false) {
  if (isBlank() && !$('#notes').value.trim()) return toast('Draw something (or add a few notes) first — it doesn’t need to be finished.');
  state.design = canvas.toDataURL('image/jpeg', .86);
  state.meta.colors = dominantColors(); state.meta.fabric = model ? look.fabric : ''; state.meta.parts = partsSummary();
  go('brief'); $('#briefempty').hidden = true; $('#briefgrid').hidden = true; $('#briefloading').hidden = false;
  const notes = $('#notes').value + (refine && state.answers ? `\n\nAnswers to maker questions:\n${state.answers}` : '');
  try {
    const out = await api('/api/analyze', { body: { image: state.design, title: $('#title').value, notes, meta: { template: state.meta.template, elements: [...state.meta.elements], colors: state.meta.colors, fabric: model ? look.fabric : '', parts: partsSummary() } } });
    state.brief = out.brief; resetPhotos(); renderBrief(out); loadProducts();
    if (out.warning) toast(out.warning);
  } catch (e) { $('#briefempty').hidden = false; $('#briefempty').textContent = e.message; toast(e.message); }
  $('#briefloading').hidden = true;
}
const fill = (el, items, fn) => { el.replaceChildren(...items.map(fn)); };
function renderBrief({ brief: b, mode }) {
  $('#aimode').textContent = mode === 'ai' ? 'AI-generated' : 'Demo brief (no AI key set)'; $('#aimode').className = 'pill ' + (mode === 'ai' ? 'live' : 'demo');
  $('#briefimg').src = state.design;
  $('#briefpalette').replaceChildren(...b.palette.map((c) => h('span', { class: 'dot', style: `background:${c}`, title: c })));
  $('#b-title').textContent = b.title; $('#b-summary').textContent = b.summary;
  fill($('#b-components'), b.components, (c) => h('li', {}, h('b', { text: c.name }), h('small', { text: c.description })));
  fill($('#b-materials'), b.materials, (m) => h('li', {}, h('b', { text: m.name }), h('small', { text: m.reason })));
  fill($('#b-construction'), b.construction, (s) => h('li', { text: s }));
  fill($('#b-improve'), b.improvements, (s) => h('li', { text: s }));
  fill($('#b-alt'), b.alternatives, (s) => h('li', { text: s }));
  $('#b-complexity').replaceChildren(...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= b.complexity ? 'on' : '' })));
  $('#b-lead').textContent = `≈ ${b.leadTimeWeeks} weeks to make`;
  fill($('#b-questions'), b.questions, (q) => h('label', { class: 'q' }, q, h('input', { 'data-q': q, maxlength: '200', placeholder: 'Your answer (optional)' })));
  $('#briefgrid').hidden = false;
}
$('#develop').addEventListener('click', () => develop(false));
$('#refine').addEventListener('click', () => {
  state.answers = $$('#b-questions input').filter((i) => i.value.trim()).map((i) => `Q: ${i.dataset.q}\nA: ${i.value.trim()}`).join('\n');
  if (!state.answers) return toast('Type an answer to at least one question first.');
  develop(true);
});



/* ---------------- product recommendations (Channel3) ---------------- */
const money2 = (n, cur) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(n); } catch { return `${cur || ''} ${n}`; } };
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : '');
async function loadProducts() {
  const box = $('#prodgroups'); state.products = [];
  box.replaceChildren(...state.brief.materials.slice(0, 5).map(() => h('div', { class: 'pskel' })));
  $('#prodhint').textContent = 'Searching shops for each material…';
  try {
    const out = await api('/api/products', { body: { materials: state.brief.materials } });
    state.products = out.groups;
    $('#prodhint').textContent = out.mode === 'live' ? 'Real products matched to each material in your design (via Channel3). Opens the seller’s page.' : 'Demo mode: add a CHANNEL3_API_KEY to see real products here. The links search shops for each material.';
    box.replaceChildren(...out.groups.map((g) => h('div', { class: 'pgroup' },
      h('header', {}, h('b', { text: g.material }), h('small', { text: g.reason }), h('a', { href: httpUrl(g.shopUrl) || '#', target: '_blank', rel: 'noopener noreferrer', text: 'Search online ↗' })),
      g.products.length ? h('div', { class: 'pcards' }, g.products.map((p) => h('a', { class: 'pcard', href: httpUrl(p.url) || '#', target: '_blank', rel: 'noopener noreferrer' },
        httpUrl(p.image) ? h('img', { src: p.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
        h('span', { class: 't', text: p.title }), p.price != null ? h('span', { class: 'p', text: money2(p.price, p.currency) }) : null, h('span', { class: 'm', text: p.domain || p.brand || '' }))))
        : h('p', { class: 'hint', text: out.mode === 'live' ? (g.error ? 'Couldn’t reach the product search just now — use “Search online”.' : 'No close matches found — try “Search online”.') : 'Connect Channel3 to list real products here.' }))));
  } catch (e) { $('#prodhint').textContent = e.message; box.replaceChildren(); }
}

/* ---------------- photoreal preview ("see it in real life") ---------------- */
const VIEW_LIST = [['front', 'Front'], ['angle', '¾ view'], ['side', 'Side'], ['back', 'Back']];
let photoBusy = false;
VIEW_LIST.forEach(([k, name]) => $('#viewchips').append(h('button', { class: 'chip', 'data-view': k, text: name, onclick: () => showView(k, true) })));
function resetPhotos() {
  state.photos = {}; state.curView = 'front';
  $('#photoimg').removeAttribute('src'); $('#viewer').classList.remove('ph'); $('#draghint').hidden = true;
  $('#photohint').textContent = 'AI turns your design into a photoreal product shot, then lets you turn it around.';
  $('#genphoto').hidden = false; syncChips();
}
function syncChips() { $$('#viewchips .chip').forEach((b) => { b.classList.toggle('on', b.dataset.view === state.curView); b.classList.toggle('has', !!state.photos[b.dataset.view]); }); }
async function showView(view, generate, force) {
  if (photoBusy) return;
  if (state.config?.photoProvider === 'stability') view = 'front';
  if (!state.photos[view] || force) {
    if (!generate) return;
    photoBusy = true; $('#viewload').hidden = false; $('#genphoto').disabled = true;
    try {
      const b = state.brief;
      const out = await api('/api/photo', { body: { image: state.design, view, title: b.title, category: b.category, summary: b.summary, palette: b.palette, fabric: state.meta.fabric || '', parts: state.meta.parts || [] } });
      if (out.mode === 'demo') {
        $('#photoimg').src = state.design; $('#viewer').classList.add('ph'); $('#draghint').hidden = true; state.curView = view;
        $('#photohint').textContent = 'Demo mode: showing your design with a 3D tilt. Add a STABILITY_API_KEY (or GEMINI_API_KEY) to get real AI product photos.';
        $('#genphoto').hidden = true;
      } else { state.photos[view] = out.image; }
    } catch (e) { toast(e.message); }
    photoBusy = false; $('#viewload').hidden = true; $('#genphoto').disabled = false;
    if (!state.photos[view]) { syncChips(); return; }
  }
  state.curView = view; $('#viewer').classList.remove('ph'); $('#photoimg').src = state.photos[view];
  const n = Object.keys(state.photos).length;
  if (state.config?.photoProvider === 'stability') { $('#draghint').hidden = true; $('#genphoto').hidden = false; $('#genphoto').textContent = '↻ Another take'; $('#photohint').textContent = 'Rendered by Stability AI from your design’s outline, colours and fabric. Tap “Another take” for a different version.'; syncChips(); return; }
  $('#draghint').hidden = n < 2; $('#genphoto').hidden = true; syncChips();
  $('#photohint').textContent = n < 2 ? 'Tap “¾ view”, “Side” or “Back” to see it from other angles.' : 'Drag left / right to turn it around. Tap an angle to develop more.';
}
$('#genphoto').addEventListener('click', () => showView('front', true, state.config?.photoProvider === 'stability' && !!state.photos.front));
(function tilt() {
  const v = $('#viewer'), st = $('#stage3d'); let down = false, sx = 0, base = 0;
  const order = VIEW_LIST.map((x) => x[0]);
  v.addEventListener('pointermove', (e) => {
    const r = v.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    st.style.transform = `rotateY(${x * 16}deg) rotateX(${-y * 10}deg)`;
    if (down) { const have = order.filter((k) => state.photos[k]); if (have.length > 1) { const step = Math.round((sx - e.clientX) / 90); const i = Math.max(0, Math.min(have.length - 1, base + step)); if (have[i] !== state.curView) showView(have[i], false); } }
  });
  v.addEventListener('pointerleave', () => { st.style.transform = ''; });
  v.addEventListener('pointerdown', (e) => { down = true; sx = e.clientX; base = Math.max(0, order.filter((k) => state.photos[k]).indexOf(state.curView)); v.setPointerCapture(e.pointerId); });
  ['pointerup', 'pointercancel'].forEach((t) => v.addEventListener(t, () => { down = false; }));
})();

/* ---------------- step 3: makers ---------------- */
$('#tomakers').addEventListener('click', async () => {
  state.answers = $$('#b-questions input').filter((i) => i.value.trim()).map((i) => `Q: ${i.dataset.q}\nA: ${i.value.trim()}`).join('\n');
  go('makers'); $('#makersempty').hidden = true;
  const b = state.brief;
  try {
    const { makers } = await api(`/api/makers?category=${encodeURIComponent(b.category)}&tags=${encodeURIComponent(b.makerTags.join(','))}`);
    fill($('#makerlist'), makers, (m) => h('article', { class: 'maker' },
      h('header', {}, h('div', { class: 'avatar', style: `background:hsl(${m.hue} 45% 42%)`, text: m.name.split(' ').map((w) => w[0]).join('') }),
        h('div', {}, h('h3', { text: m.name }), h('div', { class: 'where', text: m.place })),
        h('div', { class: 'match' }, `${m.match}%`, h('small', { text: 'match' }))),
      h('p', { text: `${m.craft}. ${m.bio}`, style: 'margin:0' }),
      h('div', { class: 'tags' }, m.skills.slice(0, 7).map((s) => h('span', { class: 'tag' + (m.matchedSkills.includes(s) ? ' hit' : ''), text: s }))),
      h('div', { class: 'meta' }, h('span', { text: `From ${usd(m.baseRate)}` }), h('span', { text: m.turnaround })),
      h('button', { class: 'btn primary', text: 'Request proposal', onclick: (e) => requestProposal(m, e.target) })));
  } catch (e) { toast(e.message); }
});

async function requestProposal(m, btn) {
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    state.commission = await api('/api/commissions', { body: { makerId: m.id, title: state.brief.title, design: state.design, brief: state.brief, preview: state.photos.front || null, products: state.products, message: $('#makermsg').value, answers: state.answers } });
    store.set('fasheate.commission', state.commission.id);
    toast(`${m.name} sent a proposal`); renderCommission(); go('commission');
  } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Request proposal'; }
}

/* ---------------- step 4: commission + PayPal ---------------- */
let sdkPromise;
function loadPayPal(clientId, currency) {
  if (window.paypal) return Promise.resolve(window.paypal);
  sdkPromise ||= new Promise((res, rej) => {
    const s = h('script', { src: `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture&components=buttons` });
    s.onload = () => res(window.paypal); s.onerror = () => rej(new Error('Could not load PayPal SDK')); document.head.append(s);
  });
  return sdkPromise;
}

function renderCommission() {
  const c = state.commission; if (!c) return;
  $('#comempty').hidden = true; $('#comview').hidden = false;
  const live = c.paymentMode === 'paypal-sandbox';
  $('#paymode').textContent = live ? 'PayPal Sandbox' : 'Demo payments'; $('#paymode').className = 'pill ' + (live ? 'live' : 'demo');
  const next = c.payments.find((p) => p.status !== 'paid');
  const paidAmt = c.payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const view = h('div', { class: 'com' },
    h('figure', { class: 'designcard' }, h('img', { src: c.design, alt: c.title }), c.preview ? h('img', { class: 'previewimg', src: c.preview, alt: 'AI photo preview' }) : null, h('figcaption', { text: c.title })),
    h('div', {},
      h('h3', { text: c.title, style: 'font-size:2rem' }),
      h('p', { class: 'lead', text: `${c.maker.name} · ${c.maker.place} · ${c.maker.turnaround}` }),
      h('p', { text: `${c.maker.name} reviewed your brief and proposed ${usd(c.total)} in three payments, released as the work progresses.` }),
      h('div', { class: 'banner' + (live ? ' live' : ''), text: live ? 'Sandbox mode: pay with a PayPal sandbox buyer account — no real money moves.' : 'Demo mode: no PayPal credentials are configured, so payments are simulated locally. Add sandbox credentials to use real PayPal Checkout (see README).' }),
      c.products && c.products.some((g) => g.products.length) ? h('div', { class: 'shared' }, h('h4', { text: 'Materials shared with your maker' }), h('ul', {}, c.products.filter((g) => g.products.length).map((g) => h('li', {}, h('b', { text: g.material + ': ' }), h('a', { href: httpUrl(g.products[0].url) || '#', target: '_blank', rel: 'noopener noreferrer', text: g.products[0].title.slice(0, 70) }))))) : null,
      h('div', { class: 'timeline' }, c.payments.map((p, i) => h('div', { class: 'pay' + (p === next ? ' next' : '') + (p.status === 'paid' ? ' paid' : '') },
        h('div', { class: 'head' }, h('span', { class: 'num', text: p.status === 'paid' ? '✓' : String(i + 1) }),
          h('div', {}, h('b', { text: p.label }), h('div', { class: 'note', text: p.note })), h('span', { class: 'amt', text: usd(p.amount) })),
        p.status === 'paid' ? h('div', { class: 'receipt', text: `Captured ${p.captureId} · ${new Date(p.paidAt).toLocaleString()}` })
          : p === next ? h('div', { class: 'ppwrap', id: 'pp-' + p.id }) : h('div', { class: 'note', text: 'Unlocks after the previous payment.' })))),
      h('div', { class: 'total' }, h('span', { text: `Paid ${usd(paidAmt)}` }), h('span', { text: `Total ${usd(c.total)}` })),
      c.status === 'complete' ? h('div', { class: 'complete', text: 'All payments complete — your idea now exists. 🎉' }) : null,
      h('div', { class: 'row', style: 'margin-top:1rem' }, h('button', { class: 'btn ghost', 'data-go': 'studio', text: 'Start another idea' }))));
  $('#comview').replaceChildren(view);
  if (next) mountPayButton(c, next);
}

async function mountPayButton(c, pay) {
  const host = $('#pp-' + pay.id); if (!host) return;
  const endpoint = (x) => `/api/commissions/${c.id}/payments/${pay.id}/${x}`;
  const finish = async (orderId) => { state.commission = await api(endpoint('capture'), { body: { orderId } }); toast(`${pay.label} paid`); renderCommission(); };
  if (c.paymentMode === 'paypal-sandbox') {
    try {
      const paypal = await loadPayPal(state.config.paypalClientId, state.config.currency);
      paypal.Buttons({
        style: { layout: 'vertical', shape: 'pill', label: 'pay' },
        createOrder: async () => (await api(endpoint('order'), { body: {} })).id,
        onApprove: async (data) => { try { await finish(data.orderID); } catch (e) { toast(e.message); } },
        onCancel: () => toast('Payment cancelled — nothing was charged'),
        onError: (e) => toast(e.message || 'PayPal error'),
      }).render(host);
    } catch (e) { host.textContent = e.message; }
  } else {
    host.append(h('button', { class: 'btn primary', text: `Pay ${usd(pay.amount)} with PayPal (demo)`, onclick: async (ev) => {
      ev.target.disabled = true;
      try { const { id } = await api(endpoint('order'), { body: {} }); await finish(id); } catch (e) { toast(e.message); ev.target.disabled = false; }
    } }));
  }
}

/* ---------------- boot ---------------- */
(async function boot() {
  resetCanvas(); show(location.hash.slice(1));
  try {
    state.config = await api('/api/config');
    $('#viewchips').hidden = state.config.photoProvider === 'stability';
    $('#modes').append(
      h('span', { class: 'pill ' + (state.config.aiMode === 'ai' ? 'live' : 'demo'), text: state.config.aiMode === 'ai' ? 'AI: live' : 'AI: demo' }),
      h('span', { class: 'pill ' + (state.config.productMode === 'live' ? 'live' : 'demo'), text: state.config.productMode === 'live' ? 'Products: live' : 'Products: demo' }),
      h('span', { class: 'pill ' + (state.config.photoMode === 'ai' ? 'live' : 'demo'), text: state.config.photoMode === 'ai' ? 'Photos: live' : 'Photos: demo' }),
      h('span', { class: 'pill ' + (state.config.paymentMode === 'paypal-sandbox' ? 'live' : 'demo'), text: state.config.paymentMode === 'paypal-sandbox' ? 'PayPal: sandbox' : 'PayPal: demo' }));
  } catch { toast('Could not reach the server'); }
  const id = store.get('fasheate.commission');
  if (id) { try { state.commission = await api('/api/commissions/' + id); renderCommission(); } catch { /* stale id */ } }
})();
