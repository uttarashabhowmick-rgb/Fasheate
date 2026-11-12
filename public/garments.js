'use strict';
/* Fasheate garments — realistic, fabric-aware garment renderer for the studio.
 * Each template is a set of named PANELS (sleeves, body, sole…) in a 100x100 design space.
 * Colours live in flat panel fills; texture, lighting, folds, stitching and hardware are baked once into a
 * transparent "shade" layer that is composited on top, so any colour the user picks looks like real cloth. */
(function (global) {
  const W = 900, S = W / 100;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = W; return c; };
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(); // deterministic texture

  /* ---------- helpers ---------- */
  const mirror = (d) => { let i = 0; return d.replace(/([MLQCZ])|(-?\d*\.?\d+)/g, (m, c, n) => { if (c) { i = 0; return c; } const v = parseFloat(n); const o = i % 2 === 0 ? 100 - v : v; i++; return String(+o.toFixed(2)); }); };
  const panel = (id, name, d, kind, color, group, label) => ({ id, name, label: label || name, d, kind, color, group: group || id });
  const sym = (id, label, d, kind, color) => [
    panel(id + 'L', 'Left ' + label.toLowerCase(), d, kind, color, id, label),
    panel(id + 'R', 'Right ' + label.toLowerCase(), mirror(d), kind, color, id, label)];

  function rivet(g, x, y, r = .55) {
    const gr = g.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r);
    gr.addColorStop(0, '#fff'); gr.addColorStop(.5, '#c9c2b2'); gr.addColorStop(1, '#6d6455');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = .12; g.stroke();
  }
  function eyelet(g, x, y, r = .5) {
    g.fillStyle = '#2a2622'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = '#b9b2a2'; g.lineWidth = .22; g.stroke();
  }
  function dot(g, x, y, r, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }

  /* ---------- templates ---------- */
  const T = {};

  T.dress = {
    label: 'Dress', fabric: 'silk', ground: null, sym: false,
    panels: [
      panel('skirt', 'Skirt', 'M36.5 51 L63.5 51 Q74 76 85 95 Q50 101 15 95 Q26 76 36.5 51 Z', 'cloth', '#c96b5c'),
      panel('waist', 'Waistband', 'M36.2 46 L63.8 46 L64 51.6 L36 51.6 Z', 'cloth', '#a9503f'),
      panel('bodice', 'Bodice', 'M35 6 L41 6 Q43 22 50 26 Q57 22 59 6 L65 6 L67 26 Q66 37 63.8 46 L36.2 46 Q34 37 33 26 Z', 'cloth', '#c96b5c'),
    ],
    folds: ['M41 53 Q35 75 27 97', 'M46 53 Q43 76 40 99', 'M50 52 Q50 76 50 99', 'M54 53 Q57 76 60 99', 'M59 53 Q65 75 73 97', 'M37.5 30 Q36.5 38 38 45', 'M62.5 30 Q63.5 38 62 45', 'M22 78 Q20 88 20 94', 'M78 78 Q80 88 80 94'],
    stitches: ['M36.4 49.6 L63.6 49.6', 'M36.8 47.4 L63.2 47.4', 'M41.9 7 Q43.7 21 50 25 Q56.3 21 58.1 7', 'M43 33 Q46 40 44 45', 'M57 33 Q54 40 56 45', 'M16.5 93.2 Q50 98.6 83.5 93.2'],
    details(g) { dot(g, 50, 49, .5, '#e8d9b0'); eyelet(g, 50, 49, .25); },
  };

  T.jacket = {
    label: 'Jacket', fabric: 'denim', ground: null, sym: true,
    panels: [
      ...sym('body', 'Body', 'M40 14 L50 24 L50 82 L30 82 L29 44 Q28 30 29 21 Z', 'cloth', '#4f6d94'),
      ...sym('sleeve', 'Sleeves', 'M29 21 Q20 23 16 29 Q10 52 9 79 L21 82 Q22 62 29 46 Z', 'cloth', '#4f6d94'),
      ...sym('hem', 'Hem band', 'M30 82 L50 82 L50 90 L30.7 90 Z', 'rib', '#3c5578'),
      ...sym('cuff', 'Cuffs', 'M9 79 L21 82 L20.3 89 L8.2 86 Z', 'rib', '#3c5578'),
      ...sym('pocket', 'Pockets', 'M33 56 L44 56 L44 69 L33 69 Z', 'cloth', '#58779f'),
      panel('neck', 'Collar band', 'M40 13 Q50 8.5 60 13 L58 16.5 Q50 13.5 42 16.5 Z', 'cloth', '#3c5578'),
      ...sym('lapel', 'Collar', 'M40 13 L35 18.5 L44.5 30 L50 25 Z', 'cloth', '#58779f'),
    ],
    folds: ['M33 46 Q36 62 32 80', 'M44 38 Q42 60 46 80', 'M12 46 Q17 49 22 45', 'M11 62 Q16 66 21 62', 'M25 30 Q23 40 26 48', 'M15 33 Q13 42 13 50'],
    stitches: ['M30.8 80.7 L49.3 80.7', 'M9.6 80.9 L20.6 83.4', 'M33.8 57 L43.3 57 L43.3 68.3 L33.8 68.3 Z', 'M29.7 23 Q28.6 34 29.4 44', 'M40.6 14.8 L50 24.8', 'M36.2 19 L44.8 29', 'M10 70.5 L21.4 73'],
    details(g) {
      // zipper
      g.fillStyle = '#2e2b28'; g.fillRect(49.3, 27, 1.4, 63);
      for (let y = 28; y < 89.5; y += 1.15) { g.fillStyle = '#c9ccd1'; g.fillRect(49.35, y, .62, .55); g.fillStyle = '#9ea2a8'; g.fillRect(50.03, y + .57, .62, .55); }
      const tg = g.createLinearGradient(49, 0, 51, 0); tg.addColorStop(0, '#e9ebee'); tg.addColorStop(1, '#8e9298');
      g.fillStyle = tg; g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = .14;
      g.beginPath(); g.roundRect(49.1, 27.3, 1.8, 2.8, .5); g.fill(); g.stroke();
      g.beginPath(); g.roundRect(49.5, 30, 1, 3.8, .5); g.fill(); g.stroke();
      [[33.7, 57.1], [43.3, 57.1], [66.3, 57.1], [56.7, 57.1]].forEach(([x, y]) => rivet(g, x, y));
    },
  };

  T.bag = {
    label: 'Bag', fabric: 'leather', ground: 97, sym: false,
    panels: [
      panel('handles', 'Handles', 'M32 40 C30 4 70 4 68 40 L62 40 C63 14 37 14 38 40 Z', 'cloth', '#8a5a36'),
      panel('body', 'Body', 'M18 38 L82 38 L88 92 Q88.5 95.5 85 95.5 L15 95.5 Q11.5 95.5 12 92 Z', 'cloth', '#b98a5a'),
      panel('rim', 'Top band', 'M17.8 38 L82.2 38 L82.8 45.5 L17.2 45.5 Z', 'cloth', '#a67748'),
      panel('pocket', 'Front pocket', 'M30 62 L70 62 L72 84 Q72 85 71 85 L29 85 Q28 85 28 84 Z', 'cloth', '#c79a68'),
    ],
    folds: ['M25 50 Q28 70 23 91', 'M75 50 Q72 70 77 91', 'M45 48 Q47 70 44 93', 'M55 48 Q57 68 56 92', 'M34 67 Q35 75 34 82', 'M66 67 Q65 75 66 82'],
    stitches: ['M17.5 44 L82.5 44', 'M30.8 63.1 L69.2 63.1 L70.9 83.9 L29.1 83.9 Z', 'M35 40 C33.6 11 66.4 11 65 40', 'M13 90 L87 90'],
    details(g) { rivet(g, 35, 42, .9); rivet(g, 65, 42, .9); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(48.5, 62.4, 3, .8); },
  };

  T.shoe = {
    label: 'Shoe', fabric: 'cotton', ground: 87, sym: false,
    panels: [
      panel('tongue', 'Tongue', 'M27 38 L32.5 27.5 Q39 26 40.5 32.5 L44.5 47.5 Q35 45 28.5 40.5 Z', 'cloth', '#e9e5dc'),
      panel('upper', 'Upper', 'M10 73 L10.4 45 Q11 38.5 17 38 L27 38 Q34 44 44 47 Q58 50 74 56 Q91 61.5 95.5 73 Z', 'cloth', '#e9e5dc'),
      panel('quarter', 'Side stripe', 'M20 72.4 Q38 70.5 55 58.5 Q63 53 72 57 Q60 69.5 40 74 Q28 75.4 20 72.4 Z', 'cloth', '#b5403a'),
      panel('toe', 'Toe cap', 'M80 58.6 Q92 62.8 95.5 73 L68 73 Q70 63.5 80 58.6 Z', 'cloth', '#d8d3c8'),
      panel('heel', 'Heel counter', 'M10 73 L10.4 50 Q16.5 48 21 53.5 Q22.5 64 20.5 73 Z', 'cloth', '#b5403a'),
      panel('midsole', 'Midsole', 'M6.5 72 L96.5 72 L97 78.4 L6.4 78.4 Z', 'rubber', '#f2efe8'),
      panel('sole', 'Outsole', 'M6.4 78.4 L97 78.4 Q97.4 85.6 89 86.4 L13 86.4 Q6.2 86 6.4 78.4 Z', 'rubber', '#33302c'),
    ],
    folds: ['M56 52.5 Q60 55.5 61.5 59.5', 'M30 44 Q33 49 32.5 54'],
    stitches: ['M21.5 71.2 Q38 69.5 55 57.6', 'M11.5 38.8 Q13 36.8 17.5 36.8 L26.5 37', 'M71 59 Q84 61.5 94 69', 'M7 75.2 L96.5 75.2', 'M11 49 Q16 47.5 20.4 52.5'],
    details(g) {
      const pts = [[29.2, 39.2], [33.1, 41.8], [37.4, 44], [42, 45.9], [47, 47.3], [51.5, 48.4]];
      g.lineCap = 'round';
      pts.forEach(([x, y]) => {
        g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 2.4, y + 2.6); g.lineTo(x + 2.4, y - 2.2); g.stroke();
        g.strokeStyle = '#f6f3ec'; g.lineWidth = 1.05; g.beginPath(); g.moveTo(x - 2.4, y + 2.2); g.lineTo(x + 2.4, y - 2.6); g.stroke();
        eyelet(g, x - 2.9, y + 2.7, .38); eyelet(g, x + 2.8, y - 2.4, .38);
      });
      g.strokeStyle = '#f6f3ec'; g.lineWidth = 1; g.beginPath(); g.moveTo(51.5, 48.4); g.quadraticCurveTo(49.5, 41.5, 55.5, 43.2); g.quadraticCurveTo(54, 49.2, 51.5, 48.4); g.moveTo(51.5, 48.4); g.quadraticCurveTo(57, 46, 57.2, 51.6); g.quadraticCurveTo(52.6, 53, 51.5, 48.4); g.stroke();
      [[84, 66], [87.5, 68.6], [81, 63.6]].forEach(([x, y]) => dot(g, x, y, .38, 'rgba(0,0,0,.35)'));
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = .35;
      for (let x = 12; x < 94; x += 3.2) { g.beginPath(); g.moveTo(x, 80.2); g.lineTo(x - .6, 85); g.stroke(); }
    },
  };

  T.hat = {
    label: 'Hat', fabric: 'cotton', ground: 82, sym: false,
    panels: [
      panel('crown', 'Crown', 'M24 57 Q22 31 50 27 Q78 31 76 57 Z', 'cloth', '#c2b280'),
      panel('band', 'Band', 'M23.7 49 L76.3 49 L76.6 58 L23.4 58 Z', 'cloth', '#3d2b56'),
      panel('brim', 'Brim', 'M8.5 61.5 Q50 46.5 91.5 61.5 Q98 73 83 76.5 Q50 87 17 76.5 Q2 73 8.5 61.5 Z', 'cloth', '#b3a46f'),
    ],
    folds: ['M36 32 Q33 43 34 55', 'M50 28 Q50 40 50 55', 'M64 32 Q67 43 66 55', 'M43 29 Q41 41 42 55', 'M57 29 Q59 41 58 55', 'M18 68 Q24 74 30 77'],
    stitches: ['M15 66.8 Q50 52.5 85 66.8', 'M12 69.4 Q50 55 88 69.4', 'M18 72.2 Q50 60.5 82 72.2', 'M24 49.8 L76 49.8', 'M24 57.2 L76 57.2'],
    details(g) { eyelet(g, 29, 44, .7); eyelet(g, 71, 44, .7); },
  };

  T.chair = {
    label: 'Chair', fabric: 'cotton', ground: 95, sym: false,
    panels: [
      panel('farlegs', 'Far legs', 'M60 62 L65 62 L66 92 L61 92 Z M35 62 L40 62 L38 92 L33 92 Z', 'wood', '#a98458', 'legs', 'Legs'),
      panel('stretch', 'Stretcher', 'M29 79 L72 79 L72 83.4 L29 83.4 Z', 'wood', '#c8a374', 'frame', 'Frame'),
      panel('legs', 'Legs', 'M68 62 L73.5 62 L75 94 L69.5 94 Z M26 62 L31.5 62 L28 94 L22.5 94 Z', 'wood', '#c8a374', 'legs', 'Legs'),
      panel('seatframe', 'Seat frame', 'M24.5 58 L76.5 58 L76.5 63 L24.5 63 Z', 'wood', '#c8a374', 'frame', 'Frame'),
      panel('back', 'Backrest', 'M27 52 L23.5 13 Q23.2 8.5 28 8.5 L35.5 8.5 Q38.6 8.5 38.4 13 L35.6 52 Z', 'wood', '#c8a374', 'frame', 'Frame'),
      panel('seat', 'Seat cushion', 'M23 51 Q23 46 29 46 L72 46 Q78 46 78 51.5 L78 59 L23 59 Z', 'cloth', '#7f9486', 'seat', 'Seat'),
    ],
    folds: ['M30 49 Q40 52.5 51 49.5 Q61 47 72 50', 'M29 16 Q29.6 30 30 44'],
    stitches: ['M23.6 48 Q50 45.6 77.4 48', 'M23 57 L78 57', 'M25 13.6 Q25 11 28.5 11 L35 11 Q37 11 37.2 13.4'],
    details(g) { [[36, 53], [51, 53.8], [66, 53]].forEach(([x, y]) => { dot(g, x, y, .9, 'rgba(0,0,0,.28)'); dot(g, x - .15, y - .2, .55, 'rgba(0,0,0,.35)'); }); },
  };

  const ORDER = ['dress', 'jacket', 'bag', 'shoe', 'hat', 'chair'];
  const FABRICS = [['cotton', 'Cotton'], ['denim', 'Denim'], ['silk', 'Silk'], ['leather', 'Leather'], ['knit', 'Wool knit']];

  /* ---------- textures ---------- */
  const tiles = {};
  function tile(kind) {
    if (kind in tiles) return tiles[kind];
    const mkTile = (n, fn) => { const c = document.createElement('canvas'); c.width = c.height = n; fn(c.getContext('2d'), n); return c; };
    const px = (g, x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    let t = null;
    if (kind === 'cotton') t = mkTile(4, (g) => { px(g, 0, 0, 'rgba(0,0,0,.10)', 2, 2); px(g, 2, 2, 'rgba(0,0,0,.10)', 2, 2); px(g, 2, 0, 'rgba(255,255,255,.12)', 2, 2); px(g, 0, 2, 'rgba(255,255,255,.12)', 2, 2); });
    else if (kind === 'denim') t = mkTile(8, (g, n) => { for (let i = 0; i < n; i++) { px(g, i, i, 'rgba(0,0,0,.26)'); px(g, (i + 1) % n, i, 'rgba(255,255,255,.16)'); px(g, (i + 4) % n, i, 'rgba(255,255,255,.07)'); } for (let k = 0; k < 8; k++) px(g, Math.floor(rnd() * n), Math.floor(rnd() * n), 'rgba(255,255,255,.18)'); });
    else if (kind === 'knit') t = mkTile(8, (g) => { g.lineCap = 'round'; g.lineWidth = 1.6; g.strokeStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(4, 6); g.lineTo(8, 0); g.stroke(); g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.moveTo(0, 1.4); g.lineTo(4, 7.4); g.lineTo(8, 1.4); g.stroke(); });
    else if (kind === 'rib') t = mkTile(6, (g) => { px(g, 0, 0, 'rgba(0,0,0,.28)', 1.5, 6); px(g, 3, 0, 'rgba(255,255,255,.18)', 1.5, 6); });
    else if (kind === 'leather') t = mkTile(96, (g, n) => { for (let i = 0; i < 380; i++) { const r = .5 + rnd() * 1.1, x = rnd() * n, y = rnd() * n; g.fillStyle = `rgba(0,0,0,${.05 + rnd() * .15})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = `rgba(255,255,255,${rnd() * .09})`; g.beginPath(); g.arc(x + .8, y + .8, r * .8, 0, 7); g.fill(); } });
    else if (kind === 'rubber') t = mkTile(64, (g, n) => { for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(0,0,0,${.05 + rnd() * .1})`; g.beginPath(); g.arc(rnd() * n, rnd() * n, .5 + rnd() * .7, 0, 7); g.fill(); } });
    else if (kind === 'wood') t = mkTile(160, (g, n) => { for (let i = 0; i < 34; i++) { const y0 = rnd() * n, amp = 1 + rnd() * 3, k = 1 + Math.floor(rnd() * 2), ph = rnd() * 6; g.strokeStyle = `rgba(70,42,14,${.06 + rnd() * .12})`; g.lineWidth = .5 + rnd() * 1.4; g.beginPath(); for (let x = 0; x <= n; x += 4) { const y = y0 + Math.sin(ph + (2 * Math.PI * k * x) / n) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } });
    tiles[kind] = t; return t;
  }

  /* ---------- baking ---------- */
  const cache = {};
  const defaults = (key) => Object.fromEntries(T[key].panels.map((p) => [p.id, p.color]));

  function bakeStage(key, union, tpl) {
    const c = mk(), g = c.getContext('2d');
    const bg = g.createRadialGradient(W * .5, W * .42, W * .08, W * .5, W * .5, W * .78);
    bg.addColorStop(0, '#f8f5f0'); bg.addColorStop(1, '#d6cfc3'); g.fillStyle = bg; g.fillRect(0, 0, W, W);
    // soft vignette + floor line
    const fl = g.createLinearGradient(0, W * .8, 0, W); fl.addColorStop(0, 'rgba(255,255,255,0)'); fl.addColorStop(1, 'rgba(0,0,0,.07)'); g.fillStyle = fl; g.fillRect(0, W * .8, W, W * .2);
    if (!union) return c;
    if (tpl.ground) { // contact shadow
      g.save(); g.translate(W / 2, tpl.ground * S); g.scale(1, .1);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, W * .42); r.addColorStop(0, 'rgba(0,0,0,.42)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.beginPath(); g.arc(0, 0, W * .42, 0, 7); g.fill(); g.restore();
    }
    // drop shadow of the silhouette (drawn off-canvas, only the shadow lands in view)
    g.save(); g.translate(-4000, 0); g.scale(S, S); g.shadowColor = 'rgba(40,25,10,.36)'; g.shadowBlur = tpl.ground ? 22 : 34; g.shadowOffsetX = 4000; g.shadowOffsetY = tpl.ground ? 8 : 20; g.fillStyle = '#000'; g.fill(union); g.restore();
    return c;
  }

  function bakeShade(key, fabric) {
    const tpl = T[key], m = cache[key];
    const c = mk(), g = c.getContext('2d');
    const world = () => g.setTransform(S, 0, 0, S, 0, 0), device = () => g.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of m.panels) {
      const kind = p.kind === 'cloth' ? fabric : p.kind;
      g.save(); world(); g.clip(p.path); device();
      const tl = tile(kind); if (tl) { g.fillStyle = g.createPattern(tl, 'repeat'); g.fillRect(0, 0, W, W); }
      const lg = g.createLinearGradient(W * .1, W * .05, W * .9, W * .95);
      lg.addColorStop(0, 'rgba(255,255,255,.30)'); lg.addColorStop(.45, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,0,.36)');
      g.fillStyle = lg; g.fillRect(0, 0, W, W);
      const sheen = { silk: .42, leather: .24, rubber: .15, wood: .12 }[kind];
      if (sheen) { const sg = g.createLinearGradient(W * .05, W * .15, W * .7, W * .85); sg.addColorStop(.28, 'rgba(255,255,255,0)'); sg.addColorStop(.42, `rgba(255,255,255,${sheen})`); sg.addColorStop(.55, 'rgba(255,255,255,0)'); g.fillStyle = sg; g.fillRect(0, 0, W, W); }
      world(); // soft inner edge shadow = thickness
      g.lineJoin = 'round';
      [[1.8, .05], [1.1, .08], [.6, .11]].forEach(([w, a]) => { g.lineWidth = w; g.strokeStyle = `rgba(0,0,0,${a})`; g.stroke(p.path); });
      g.restore();
    }
    world();
    g.lineJoin = 'round'; g.lineWidth = .2; g.strokeStyle = 'rgba(0,0,0,.5)'; for (const p of m.panels) g.stroke(p.path);
    // folds + stitches clipped to the garment silhouette
    g.save(); g.clip(m.union); g.lineCap = 'round';
    for (const f of m.folds) {
      const pa = new Path2D(f);
      g.strokeStyle = 'rgba(0,0,0,.04)'; g.lineWidth = 2.6; g.stroke(pa);
      g.strokeStyle = 'rgba(0,0,0,.065)'; g.lineWidth = 1.3; g.stroke(pa);
      g.save(); g.translate(1.1, -.1); g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1.1; g.stroke(pa); g.restore();
    }
    g.setLineDash([.95, .7]); g.lineWidth = .24;
    for (const s of m.stitches) {
      const pa = new Path2D(s);
      g.save(); g.translate(.1, .12); g.strokeStyle = 'rgba(0,0,0,.34)'; g.stroke(pa); g.restore();
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.stroke(pa);
    }
    g.setLineDash([]); g.restore();
    g.save(); tpl.details(g); g.restore();
    return c;
  }

  function build(key, fabric) {
    const tpl = T[key];
    if (!cache[key]) {
      const panels = tpl.panels.map((p) => ({ ...p, path: new Path2D(p.d) }));
      const union = new Path2D(); panels.forEach((p) => union.addPath(p.path));
      const dup = (arr) => (tpl.sym ? arr.concat(arr.map(mirror)) : arr);
      cache[key] = { panels, union, folds: dup(tpl.folds), stitches: dup(tpl.stitches), shades: {}, stage: null };
      cache[key].stage = bakeStage(key, union, tpl);
    }
    const m = cache[key], f = fabric || tpl.fabric;
    if (!m.shades[f]) m.shades[f] = bakeShade(key, f);
    return { key, tpl, fabric: f, panels: m.panels, stage: m.stage, shade: m.shades[f] };
  }
  const blankStage = () => (cache._blank ||= bakeStage('', null, null));

  global.Garments = { S, W, order: ORDER, label: (k) => T[k].label, defaultFabric: (k) => T[k].fabric, defaults, build, blankStage, FABRICS };
})(window);
