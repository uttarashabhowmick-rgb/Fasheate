'use strict';
/**
 * Fasheate — imagine it, create it, bring it to life.
 * Zero-dependency Node server: static files + JSON API.
 *   - AI:     Anthropic Messages API (vision) -> structured production brief
 *   - PayPal: Orders API (create) + Capture API, Sandbox by default
 * Without credentials the app falls back to a clearly-labelled demo mode.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = process.env.FASHEATE_DB || path.join(ROOT, 'data', 'db.json');

// ---------- tiny .env loader ----------
(function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const cfg = () => ({
  port: Number(process.env.PORT) || 3000,
  paypalId: process.env.PAYPAL_CLIENT_ID || '',
  paypalSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  paypalBase: process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  channel3Key: process.env.CHANNEL3_API_KEY || '',
  channel3Base: process.env.CHANNEL3_API_BASE || 'https://api.trychannel3.com',
  stabilityKey: process.env.STABILITY_API_KEY || '',
  stabilityBase: process.env.STABILITY_API_BASE || 'https://api.stability.ai',
  stabilityStrength: Math.min(1, Math.max(0, Number(process.env.STABILITY_CONTROL_STRENGTH) || 0.7)),
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
  geminiBase: process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  currency: 'USD',
});
const paypalLive = () => !!(cfg().paypalId && cfg().paypalSecret);
const photoProvider = () => (cfg().stabilityKey ? 'stability' : cfg().geminiKey ? 'gemini' : 'demo');
const aiLive = () => !!(cfg().anthropicKey || cfg().geminiKey);

// ---------- sample makers (seed data for the prototype) ----------
const MAKERS = [
  { id: 'm1', name: 'Anaya Rao', place: 'Jaipur, India', craft: 'Block-print & hand-embroidered womenswear',
    categories: ['dress', 'jacket', 'accessory'], skills: ['embroidery', 'block print', 'cotton', 'linen', 'silk', 'pattern making', 'hand stitching'],
    baseRate: 180, turnaround: '3–4 weeks', hue: 14, bio: 'Third-generation textile artisan turning sketches into wearable heritage.' },
  { id: 'm2', name: 'Leo Marchetti', place: 'Florence, Italy', craft: 'Leather bags, belts & small goods',
    categories: ['bag', 'accessory', 'shoe'], skills: ['leather', 'saddle stitching', 'hardware', 'pattern making', 'canvas', 'dyeing'],
    baseRate: 240, turnaround: '4–6 weeks', hue: 28, bio: 'Bench-made leather goods, one at a time, from a tiny studio near the Arno.' },
  { id: 'm3', name: 'Mika Tanaka', place: 'Osaka, Japan', craft: 'Streetwear, outerwear & upcycled denim',
    categories: ['jacket', 'dress', 'hat', 'accessory'], skills: ['denim', 'upcycling', 'patchwork', 'sashiko', 'screen print', 'nylon', 'pattern making'],
    baseRate: 200, turnaround: '2–3 weeks', hue: 205, bio: 'Reworks vintage fabric into bold, one-of-a-kind outerwear.' },
  { id: 'm4', name: 'Sofia Alvarez', place: 'Lisbon, Portugal', craft: 'Footwear & sneaker customisation',
    categories: ['shoe'], skills: ['sneaker', 'leather', 'canvas', 'hand painting', 'sole work', 'dyeing', 'resin'],
    baseRate: 260, turnaround: '4–5 weeks', hue: 150, bio: 'Custom kicks painted, stitched and rebuilt from the sole up.' },
  { id: 'm5', name: 'Tomás Ekwueme', place: 'Lagos, Nigeria', craft: 'Tailoring, ankara & occasion wear',
    categories: ['dress', 'jacket', 'hat'], skills: ['tailoring', 'ankara', 'cotton', 'silk', 'beading', 'pattern making', 'hand stitching', 'embroidery'],
    baseRate: 150, turnaround: '2–3 weeks', hue: 340, bio: 'Sharp tailoring with fearless colour — fittings by video call.' },
  { id: 'm6', name: 'Ingrid Solberg', place: 'Bergen, Norway', craft: 'Furniture & wood / metal objects',
    categories: ['chair', 'accessory', 'other'], skills: ['woodwork', 'joinery', 'metalwork', 'upholstery', 'prototyping', 'resin', 'ceramics'],
    baseRate: 320, turnaround: '5–8 weeks', hue: 95, bio: 'Makes the strange chair you sketched on a napkin — properly.' },
  { id: 'm7', name: 'Priya Nair', place: 'Kochi, India', craft: 'Jewellery, accessories & millinery',
    categories: ['accessory', 'hat', 'bag'], skills: ['beading', 'metalwork', 'resin', 'wire work', 'hand stitching', 'straw', 'embroidery'],
    baseRate: 120, turnaround: '2–3 weeks', hue: 275, bio: 'Small-batch accessories, from statement earrings to woven hats.' },
];

// ---------- persistence ----------
let db = { commissions: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { /* fresh db */ }
function saveDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.json': 'application/json' };
const uid = (p) => p + crypto.randomBytes(5).toString('hex');
const clampStr = (v, n) => String(v ?? '').slice(0, n);

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}
function readJson(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const fail = (status, message) => Object.assign(new Error(message), { status });
const isImageDataUrl = (s) => typeof s === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s);

// =====================================================================
//  AI — design interpretation and production brief
// =====================================================================
const BRIEF_PROMPT = `You are Fasheate's creative-to-production assistant. A person has made their OWN design (sketch/drawing, possibly on a template) and wants to know how it could be made in the real world by an independent maker.
Do NOT redesign it or praise it generically: interpret what is actually in the image and the notes, then make it practical.
Return ONLY a JSON object (no markdown) with exactly these keys:
{
 "title": string,                       // short name for the piece
 "summary": string,                     // 2 sentences describing what you see and the intent
 "category": "dress"|"jacket"|"bag"|"shoe"|"hat"|"accessory"|"chair"|"other",
 "components": [{"name": string, "description": string}],      // 3-6 major parts / design elements
 "palette": [string],                   // hex colours you see
 "materials": [{"name": string, "reason": string, "search": string}], // 4-6 real materials/components to buy (fabric, hardware like zips/buttons, trims/patches); "search" = what a shopper would type, with colour + material, e.g. "black denim fabric" or "silver metal zipper"
 "construction": [string],              // 4-7 ordered, plain-language build steps
 "complexity": 1|2|3|4|5,               // 1 = simple, 5 = highly complex
 "leadTimeWeeks": number,
 "questions": [string],                 // 3-5 specific things a maker would still need to know (sizes, fit, colours, budget, use)
 "improvements": [string],              // 2-4 practical suggestions that keep the person's intent
 "alternatives": [string],              // 1-3 cheaper or easier alternatives
 "makerTags": [string]                  // 3-6 skills from: embroidery, block print, cotton, linen, silk, leather, denim, upcycling, patchwork, sashiko, screen print, nylon, tailoring, ankara, beading, pattern making, hand stitching, hardware, saddle stitching, canvas, dyeing, sneaker, hand painting, resin, woodwork, joinery, metalwork, upholstery, prototyping, wire work, straw, ceramics
}`;

const CATEGORY_DEFAULTS = {
  dress: { materials: [['Cotton poplin or linen blend', 'Breathable, holds shape, easy to dye or print'], ['Silk habotai lining', 'Smooth feel against skin'], ['Invisible zipper', 'Clean closure along the seam']], tags: ['tailoring', 'pattern making', 'cotton', 'embroidery'], weeks: 3 },
  jacket: { materials: [['Cotton twill or denim', 'Structured, durable outer layer'], ['Cupro or viscose lining', 'Comfortable and lets the jacket slide on'], ['Metal snaps or YKK zip', 'Reliable, repairable fastening']], tags: ['tailoring', 'denim', 'pattern making', 'patchwork'], weeks: 4 },
  bag: { materials: [['Vegetable-tanned leather', 'Ages well, takes dye and tooling'], ['Heavy canvas', 'Lighter and cheaper alternative body'], ['Brass hardware', 'Durable and easy to source']], tags: ['leather', 'saddle stitching', 'hardware', 'canvas'], weeks: 4 },
  shoe: { materials: [['Canvas or leather upper', 'Takes paint and dye well'], ['Vulcanised rubber sole', 'Grip and durability'], ['Waxed cotton laces', 'Hold knots, easy to colour-match']], tags: ['sneaker', 'hand painting', 'leather', 'canvas'], weeks: 5 },
  hat: { materials: [['Wool felt or straw', 'Can be blocked into shape'], ['Grosgrain ribbon band', 'Finishes and stiffens the edge'], ['Cotton sweatband', 'Comfort and fit']], tags: ['straw', 'hand stitching', 'beading', 'pattern making'], weeks: 3 },
  chair: { materials: [['Solid ash or oak', 'Strong, joinable, finishes beautifully'], ['Powder-coated steel', 'Slim, durable structural parts'], ['Foam + upholstery fabric', 'Seat comfort and colour']], tags: ['woodwork', 'joinery', 'metalwork', 'prototyping'], weeks: 6 },
  accessory: { materials: [['Brass or sterling wire', 'Workable and easy to finish'], ['Resin or glass beads', 'Colour and sparkle'], ['Cord or leather strap', 'Comfortable attachment']], tags: ['beading', 'metalwork', 'resin', 'wire work'], weeks: 2 },
  other: { materials: [['To be agreed with the maker', 'Depends on the final use of the object']], tags: ['prototyping', 'hand stitching'], weeks: 4 },
};
const CATEGORY_WORDS = { dress: /dress|gown|skirt|kurta|saree|sari|outfit/i, jacket: /jacket|coat|blazer|hoodie|shirt|vest/i, bag: /bag|tote|purse|backpack|clutch/i,
  shoe: /shoe|sneaker|boot|sandal|heel/i, hat: /hat|cap|beanie|bonnet/i, chair: /chair|stool|table|furniture|bench|lamp/i, accessory: /ring|earring|necklace|bracelet|belt|scarf|accessor|jewel/i };

function detectCategory(text, template) {
  if (template && CATEGORY_DEFAULTS[template]) return template;
  for (const [k, re] of Object.entries(CATEGORY_WORDS)) if (re.test(text)) return k;
  return 'other';
}

const NAMED = [['black', '#1b1b1b'], ['charcoal', '#444851'], ['grey', '#8d9096'], ['white', '#f5f3ee'], ['cream', '#e9dfc9'], ['beige', '#cdb894'], ['tan', '#b98a5a'], ['brown', '#6b4428'],
  ['red', '#d23a2a'], ['burgundy', '#6e1f2e'], ['orange', '#e98a2b'], ['mustard yellow', '#e8b04a'], ['yellow', '#f2d43d'], ['olive green', '#6f7a3c'], ['green', '#3f8a4f'], ['teal', '#14807d'],
  ['sky blue', '#6fa8dc'], ['denim blue', '#4f6d94'], ['blue', '#2f6db5'], ['navy', '#1d2c54'], ['purple', '#6a3d9a'], ['plum', '#3d2b56'], ['pink', '#e58fb0'], ['peach', '#f2c9a0']]
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorName(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '';
  const c = rgbOf(hex); let best = '', bd = 1e9;
  for (const [n, h] of NAMED) { const d = rgbOf(h).reduce((s2, v, i) => s2 + (v - c[i]) ** 2, 0); if (d < bd) { bd = d; best = n; } }
  return best;
}
const FABRIC_WORD = { cotton: 'cotton', denim: 'denim', silk: 'silk satin', leather: 'faux leather', knit: 'wool knit' };
const HARDWARE = {
  jacket: [['Silver metal zipper', 'Front closure and pockets', 'silver metal zipper'], ['Metal rivets / snap buttons', 'Pocket corners and fastenings', 'jeans rivets and snap buttons']],
  dress: [['Invisible zipper', 'Clean closure along the side seam', 'invisible zipper 20 inch'], ['Lining fabric', 'Smooth feel against skin', 'viscose lining fabric']],
  bag: [['Brass rivets and handle hardware', 'Reinforces handle attachment', 'brass rivets leather bag hardware'], ['Waxed thread', 'Strong, visible stitching', 'waxed polyester thread']],
  shoe: [['Waxed cotton shoelaces', 'Hold knots, easy to colour-match', 'waxed cotton shoelaces'], ['Rubber outsole sheet', 'Grip and durability', 'rubber shoe sole sheet']],
  hat: [['Grosgrain ribbon', 'Finishes the band and brim edge', 'grosgrain ribbon 1 inch'], ['Metal eyelets', 'Ventilation holes in the crown', 'metal eyelets grommets']],
  chair: [['Wood stain or oil', 'Protects and colours the frame', 'wood furniture oil'], ['Upholstery foam', 'Seat comfort', 'upholstery foam 2 inch']],
  accessory: [['Jewellery findings', 'Clasps and jump rings', 'jewelry making findings'], ['Beads', 'Colour and sparkle', 'glass seed beads']],
  other: [['Prototype materials', 'Depends on the final use', 'prototyping materials']],
};
/** Used when no text-AI key is configured: builds shoppable materials from the design's own parts, colours and fabric. */
function heuristicBrief({ title, notes, meta }) {
  const category = detectCategory(`${title} ${notes}`, meta.template);
  const d = CATEGORY_DEFAULTS[category];
  const colors = meta.colors.length ? meta.colors : ['#1b1713'];
  const els = meta.elements.length ? meta.elements.join(', ') : 'freehand drawing';
  const fab = FABRIC_WORD[meta.fabric] || (meta.fabric ? meta.fabric : '');
  const parts = (meta.parts || []).map((x) => { const m2 = /^(.+?):\s*(#[0-9a-f]{6})$/i.exec(x); return m2 ? { label: m2[1], hex: m2[2], name: colorName(m2[2]) } : null; }).filter(Boolean);
  const seen = new Set(); const mats = [];
  for (const pt of parts) {
    const key = pt.name; if (seen.has(key) || mats.length >= 3) continue; seen.add(key);
    const isFab = !/zip|button|rivet|lace|sole/i.test(pt.label);
    if (isFab) mats.push({ name: `${pt.name[0].toUpperCase() + pt.name.slice(1)} ${fab ? (/leather/.test(fab) ? fab : `${fab} fabric`) : 'fabric'}`, reason: `For the ${pt.label.toLowerCase()}${parts.filter((q) => q.name === pt.name).length > 1 ? ' and matching parts' : ''}`, search: `${pt.name} ${fab || ''} ${/leather/.test(fab || '') ? '' : 'fabric'}`.replace(/\s+/g, ' ').trim() });
  }
  if (!mats.length) d.materials.slice(0, 2).forEach(([name, reason]) => mats.push({ name, reason, search: name }));
  const motif = [...meta.elements].some((e) => /motif|stamp/.test(e));
  if (motif) mats.push({ name: 'Embroidered patches', reason: 'To recreate your motifs as sew-on or iron-on details', search: 'embroidered patches iron-on' });
  for (const [name, reason, search] of HARDWARE[category] || HARDWARE.other) if (mats.length < 6) mats.push({ name, reason, search });
  const colourWords = [...new Set(parts.map((q) => q.name))];
  return {
    title: title || `Untitled ${category}`,
    summary: `A ${category}${fab ? ` in ${fab}` : ''}${colourWords.length ? ` with ${colourWords.slice(0, 4).join(', ')} parts` : ''}, drawn with ${els}. ${notes ? `Intent: ${clampStr(notes, 160)}` : 'No written notes yet — the maker will need your intent.'}`,
    category,
    components: (parts.length ? parts.slice(0, 6).map((q) => ({ name: q.label, description: `${q.name}${fab ? ` ${fab}` : ''} (${q.hex}) — as drawn; exact placement to be confirmed.` })) : [
      { name: 'Main body', description: `The primary ${category} form as drawn, with proportions to be confirmed.` },
      { name: 'Colour story', description: `Dominant colours: ${colors.join(', ')}.` },
      { name: 'Surface detail', description: `Visible elements: ${els}.` },
    ]),
    palette: colors,
    materials: mats.slice(0, 6),
    construction: ['Confirm measurements and fit with the maker', 'Draft the pattern or technical drawing from your design', 'Make a sample / toile for approval', 'Source the materials listed and colour-match your palette', 'Construct the piece and add surface detail', 'Finish, quality-check and ship'],
    complexity: Math.min(5, 2 + Math.floor(meta.elements.length / 2) + (colors.length > 3 ? 1 : 0)),
    leadTimeWeeks: d.weeks,
    questions: ['What size or measurements should this be made to?', 'Which parts of the design are essential and which are flexible?', 'What is your budget range?', 'Is it for everyday use, an occasion, or display?'],
    improvements: ['Add a back or side view so the maker can see construction', 'Note any colour references (Pantone or photos)'],
    alternatives: ['Start with a simpler first version (fewer colours / no surface detail) and add detail in a second milestone'],
    makerTags: d.tags,
  };
}

function normalizeBrief(b, fallback) {
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const str = (v, n = 400) => clampStr(v, n);
  const cat = Object.keys(CATEGORY_DEFAULTS).includes(b?.category) ? b.category : fallback.category;
  const out = {
    title: str(b?.title, 80) || fallback.title,
    summary: str(b?.summary, 600) || fallback.summary,
    category: cat,
    components: arr(b?.components, 6).map((c) => ({ name: str(c?.name, 80), description: str(c?.description) })).filter((c) => c.name),
    palette: arr(b?.palette, 8).map((c) => str(c, 9)).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)),
    materials: arr(b?.materials, 6).map((m) => ({ name: str(m?.name, 80), reason: str(m?.reason), search: str(m?.search || m?.name, 100) })).filter((m) => m.name),
    construction: arr(b?.construction, 8).map((s) => str(s)).filter(Boolean),
    complexity: Math.max(1, Math.min(5, Math.round(Number(b?.complexity) || fallback.complexity))),
    leadTimeWeeks: Math.max(1, Math.min(26, Math.round(Number(b?.leadTimeWeeks) || fallback.leadTimeWeeks))),
    questions: arr(b?.questions, 6).map((s) => str(s)).filter(Boolean),
    improvements: arr(b?.improvements, 5).map((s) => str(s)).filter(Boolean),
    alternatives: arr(b?.alternatives, 4).map((s) => str(s)).filter(Boolean),
    makerTags: arr(b?.makerTags, 8).map((s) => str(s, 30).toLowerCase()).filter(Boolean),
  };
  for (const k of ['components', 'materials', 'construction', 'questions']) if (!out[k].length) out[k] = fallback[k];
  if (!out.palette.length) out.palette = fallback.palette;
  if (!out.makerTags.length) out.makerTags = fallback.makerTags;
  return out;
}

async function aiBrief({ image, title, notes, meta }) {
  const fallback = heuristicBrief({ title, notes, meta });
  if (!aiLive()) return { brief: fallback, mode: 'demo' };
  const c = cfg();
  const [, mediaType, b64] = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  const userText = `Title: ${title || '(none)'}\nMy notes: ${notes || '(none)'}\nTemplate I started from: ${meta.template || 'none'}\nElements I used: ${meta.elements.join(', ') || 'freehand'}\nDominant colours (measured): ${meta.colors.join(', ') || 'unknown'}\nFabric chosen by the person: ${meta.fabric || 'not chosen'}\nColours per garment part: ${(meta.parts || []).join('; ') || 'n/a'}`;
  let text = '';
  if (c.anthropicKey) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': c.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: c.anthropicModel, max_tokens: 1800, system: BRIEF_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } }, { type: 'text', text: userText }] }],
      }),
    });
    if (!r.ok) { console.error('Anthropic error', r.status, (await r.text()).slice(0, 300)); return { brief: fallback, mode: 'demo', warning: 'AI service unavailable — showing a template-based brief.' }; }
    const data = await r.json();
    text = (data.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
  } else {
    // Free option: Google Gemini API (key from https://aistudio.google.com/apikey)
    const r = await fetch(`${c.geminiBase}/v1beta/models/${encodeURIComponent(c.geminiModel)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': c.geminiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: BRIEF_PROMPT }] },
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mediaType, data: b64 } }, { text: userText }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2500 },
      }),
    });
    if (!r.ok) { console.error('Gemini error', r.status, (await r.text()).slice(0, 300)); return { brief: fallback, mode: 'demo', warning: 'AI service unavailable — showing a template-based brief.' }; }
    const data = await r.json();
    text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return { brief: normalizeBrief(json, fallback), mode: 'ai' };
  } catch {
    return { brief: fallback, mode: 'demo', warning: 'AI reply could not be parsed — showing a template-based brief.' };
  }
}

// =====================================================================
//  AI — photoreal "see it in real life" preview (Gemini image model)
// =====================================================================
const VIEWS = {
  front: 'a straight-on FRONT view',
  angle: 'a THREE-QUARTER view, rotated about 35 degrees to the left so the side and depth are visible',
  side: 'a pure SIDE PROFILE view',
  back: 'a REAR view showing the back of the piece',
};
async function stabilityPhoto({ image, title, category, fabric, parts, palette, summary }) {
  const c = cfg();
  const [, mediaType, b64] = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  const prompt = `Photorealistic professional product photograph of a ${category}${title ? ` called "${title}"` : ''}, exactly as designed. ${fabric ? `${fabric} material with realistic texture, ` : ''}visible stitching, natural fabric folds and real hardware. ${parts.length ? `Parts and colours: ${parts.join('; ')}. ` : ''}${palette.length ? `Palette ${palette.join(', ')}. ` : ''}${summary || ''} Soft studio lighting, real depth, natural shadows, clean neutral backdrop, catalogue photo.`.slice(0, 1800);
  const form = new FormData();
  form.append('image', new Blob([Buffer.from(b64, 'base64')], { type: mediaType }), `design.${mediaType.split('/')[1]}`);
  form.append('prompt', prompt);
  form.append('negative_prompt', 'cartoon, illustration, drawing, sketch, flat vector, toy, text, watermark, logo, blurry, deformed');
  form.append('control_strength', String(c.stabilityStrength));
  form.append('output_format', 'png');
  form.append('seed', String(1 + Math.floor(Math.random() * 4294967000)));
  const r = await fetch(`${c.stabilityBase}/v2beta/stable-image/control/structure`, {
    method: 'POST', headers: { Authorization: `Bearer ${c.stabilityKey}`, Accept: 'application/json' }, body: form, signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    console.error('Stability error', r.status, (await r.text()).slice(0, 300));
    throw fail(502, r.status === 402 ? 'Stability AI credits are used up — top up or try later.' : r.status === 429 ? 'Stability AI is rate-limiting — try again in a moment.' : r.status === 403 ? 'Stability AI declined this image (content check).' : 'Stability AI could not make a photo right now.');
  }
  const data = await r.json();
  if (!data.image || data.finish_reason === 'CONTENT_FILTERED') throw fail(502, 'Stability AI filtered this image — try a different design.');
  return `data:image/png;base64,${data.image}`;
}

async function geminiPhoto({ image, title, category, fabric, parts, palette, summary, view }) {
  const c = cfg();
  const [, mediaType, b64] = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  const prompt = `Use the attached image as the exact design reference. It is a person's own design for a ${category}${title ? ` called "${title}"` : ''}. Create a photorealistic professional product photograph of that exact item as it would look when really made, showing ${VIEWS[view]}.
Keep the design faithful: same silhouette, same colours per part${parts.length ? ` (${parts.join('; ')})` : ''}${palette.length ? `, palette ${palette.join(', ')}` : ''}${fabric ? `, ${fabric} fabric/material with realistic texture, stitching and natural fabric folds` : ''}. ${summary ? `Context: ${summary}` : ''}
Style: real-life 3D look with soft studio lighting, real depth, natural shadows and a clean neutral backdrop; clothing shown as if on an invisible mannequin, shoes/bags/furniture placed naturally on a surface. No text, no logos, no watermark, no people's faces.`;
  const r = await fetch(`${c.geminiBase}/v1beta/models/${encodeURIComponent(c.geminiImageModel)}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': c.geminiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mediaType, data: b64 } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 300); console.error('Gemini image error', r.status, t);
    throw fail(502, r.status === 429 ? 'The free image quota is used up for now — try again in a minute.' : 'The image model could not make a photo right now.');
  }
  const data = await r.json();
  const part = (data.candidates?.[0]?.content?.parts || []).find((x) => (x.inlineData || x.inline_data)?.data);
  const blob = part && (part.inlineData || part.inline_data);
  if (!blob) throw fail(502, 'The image model did not return a picture — try again.');
  return `data:${blob.mimeType || blob.mime_type || 'image/png'};base64,${blob.data}`;
}

// =====================================================================
//  Channel3 — real products for each material / component
// =====================================================================
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"'<>]{4,600}$/.test(u) ? u : '');
const shopUrl = (q) => `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`;
async function channel3Search(query) {
  const c = cfg();
  const r = await fetch(`${c.channel3Base}/v1/search`, {
    method: 'POST', headers: { 'x-api-key': c.channel3Key, 'content-type': 'application/json' },
    body: JSON.stringify({ query, limit: 6 }), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Channel3 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return (data.products || []).map((p) => {
    const offer = (p.offers || [])[0] || {};
    const imgs = (p.images || []).map((i) => (typeof i === 'string' ? i : i?.url));
    const brand = p.brand_name || (typeof p.brand === 'string' ? p.brand : p.brand?.name) || '';
    return {
      title: clampStr(p.title, 140), brand: clampStr(brand, 60), image: imgs.map(safeUrl).find(Boolean) || '',
      url: safeUrl(offer.url) || safeUrl(p.url), domain: clampStr(offer.domain, 60),
      price: offer.price?.price != null ? Number(offer.price.price) : null, currency: clampStr(offer.price?.currency || 'USD', 4),
    };
  }).filter((p) => p.title && p.url).slice(0, 3);
}
const cleanProducts = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 3).map((x) => ({
  title: clampStr(x?.title, 140), brand: clampStr(x?.brand, 60), image: safeUrl(x?.image), url: safeUrl(x?.url), domain: clampStr(x?.domain, 60),
  price: Number.isFinite(Number(x?.price)) && x?.price !== null ? Number(x.price) : null, currency: clampStr(x?.currency || 'USD', 4),
})).filter((x) => x.title && x.url);
const cleanGroups = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 6).map((g) => ({
  material: clampStr(g?.material, 80), reason: clampStr(g?.reason, 200), query: clampStr(g?.query, 100), shopUrl: safeUrl(g?.shopUrl), products: cleanProducts(g?.products),
})).filter((g) => g.material);

// =====================================================================
//  Makers + commissions
// =====================================================================
function scoreMakers(category, tags) {
  const want = new Set((tags || []).map((t) => t.toLowerCase()));
  return MAKERS.map((m) => {
    const overlap = m.skills.filter((s) => want.has(s));
    let score = 35 + (m.categories.includes(category) ? 30 : 0) + Math.min(35, overlap.length * 12);
    return { ...m, match: Math.min(99, score), matchedSkills: overlap };
  }).sort((a, b) => b.match - a.match);
}

function quoteFor(maker, brief) {
  const total = Math.round(maker.baseRate * (0.6 + 0.4 * brief.complexity));
  const deposit = Math.round(total * 0.3);
  const mid = Math.round(total * 0.4);
  return [
    { label: 'Commission deposit', note: 'Secures the maker and starts the pattern / sample', amount: deposit },
    { label: 'Milestone: sample approved', note: 'Released when you approve the sample or prototype', amount: mid },
    { label: 'Final: delivery', note: 'Released when the finished piece ships', amount: total - deposit - mid },
  ].map((p, i) => ({ id: `p${i + 1}`, ...p, status: 'pending' }));
}

const money = (n) => Number(n).toFixed(2);

// =====================================================================
//  PayPal — Orders API (create) + Capture API
// =====================================================================
let tokenCache = { value: '', exp: 0 };
async function paypalToken() {
  if (tokenCache.value && tokenCache.exp > Date.now() + 30000) return tokenCache.value;
  const c = cfg();
  const auth = Buffer.from(`${c.paypalId}:${c.paypalSecret}`).toString('base64');
  const r = await fetch(`${c.paypalBase}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw fail(502, 'PayPal authentication failed — check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET');
  const j = await r.json();
  tokenCache = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.value;
}
async function paypalFetch(pathname, body) {
  const token = await paypalToken();
  const r = await fetch(`${cfg().paypalBase}${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': crypto.randomUUID() },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('PayPal error', r.status, JSON.stringify(j).slice(0, 400)); throw fail(502, j.message || 'PayPal request failed'); }
  return j;
}

function findPayment(cid, pid) {
  const com = db.commissions[cid];
  if (!com) throw fail(404, 'Commission not found');
  const idx = com.payments.findIndex((p) => p.id === pid);
  if (idx < 0) throw fail(404, 'Payment not found');
  return { com, pay: com.payments[idx], idx };
}

async function createOrder(cid, pid) {
  const { com, pay, idx } = findPayment(cid, pid);
  if (pay.status === 'paid') throw fail(409, 'Already paid');
  if (idx > 0 && com.payments[idx - 1].status !== 'paid') throw fail(409, 'Earlier payment must be completed first');
  let orderId;
  if (paypalLive()) {
    const order = await paypalFetch('/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `${com.id}:${pay.id}`, custom_id: `${com.id}:${pay.id}`,
        description: clampStr(`Fasheate — ${pay.label} — ${com.title}`, 120),
        amount: { currency_code: cfg().currency, value: money(pay.amount) },
      }],
      payment_source: { paypal: { experience_context: { brand_name: 'Fasheate', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } },
    });
    orderId = order.id;
  } else {
    orderId = 'DEMO-' + crypto.randomBytes(6).toString('hex').toUpperCase();
  }
  pay.orderId = orderId;
  saveDb();
  return { id: orderId };
}

async function captureOrder(cid, pid, orderId) {
  const { com, pay } = findPayment(cid, pid);
  if (pay.status === 'paid') return publicCommission(com);
  if (!orderId || pay.orderId !== orderId) throw fail(400, 'Order does not match this payment');
  if (paypalLive()) {
    const cap = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`);
    const capture = cap.purchase_units?.[0]?.payments?.captures?.[0];
    if (cap.status !== 'COMPLETED' || !capture || capture.status !== 'COMPLETED') throw fail(402, `Payment not completed (status: ${capture?.status || cap.status})`);
    if (capture.amount?.value !== money(pay.amount)) throw fail(402, 'Captured amount did not match');
    pay.captureId = capture.id;
    pay.payer = cap.payer?.email_address || cap.payer?.name?.given_name || 'PayPal sandbox buyer';
  } else {
    pay.captureId = 'DEMOCAP-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    pay.payer = 'Demo buyer (no PayPal call made)';
  }
  pay.status = 'paid';
  pay.paidAt = new Date().toISOString();
  const paid = com.payments.filter((p) => p.status === 'paid').length;
  com.status = paid === com.payments.length ? 'complete' : paid === 1 ? 'in_progress' : com.status;
  saveDb();
  return publicCommission(com);
}

function publicCommission(c) { return { ...c, paymentMode: paypalLive() ? 'paypal-sandbox' : 'demo' }; }

// =====================================================================
//  Router
// =====================================================================
async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (m === 'GET' && p === '/api/config') {
    return send(res, 200, { paypalClientId: paypalLive() ? cfg().paypalId : null, currency: cfg().currency, paymentMode: paypalLive() ? 'paypal-sandbox' : 'demo', aiMode: aiLive() ? 'ai' : 'demo', photoMode: photoProvider() === 'demo' ? 'demo' : 'ai', photoProvider: photoProvider(), productMode: cfg().channel3Key ? 'live' : 'demo' });
  }

  if (m === 'POST' && p === '/api/analyze') {
    const b = await readJson(req);
    if (!isImageDataUrl(b.image)) throw fail(400, 'A PNG/JPEG/WebP image is required');
    const meta = {
      template: CATEGORY_DEFAULTS[b.meta?.template] ? b.meta.template : '',
      elements: (Array.isArray(b.meta?.elements) ? b.meta.elements : []).slice(0, 12).map((s) => clampStr(s, 30)),
      colors: (Array.isArray(b.meta?.colors) ? b.meta.colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6),
      fabric: clampStr(b.meta?.fabric, 20),
      parts: (Array.isArray(b.meta?.parts) ? b.meta.parts : []).slice(0, 12).map((x) => clampStr(x, 60)),
    };
    const out = await aiBrief({ image: b.image, title: clampStr(b.title, 80), notes: clampStr(b.notes, 1500), meta });
    return send(res, 200, out);
  }

  if (m === 'POST' && p === '/api/photo') {
    const b = await readJson(req);
    if (!isImageDataUrl(b.image)) throw fail(400, 'A design image is required');
    const view = Object.keys(VIEWS).includes(b.view) ? b.view : 'front';
    const provider = photoProvider();
    if (provider === 'demo') return send(res, 200, { mode: 'demo', view });
    const args = {
      image: b.image, title: clampStr(b.title, 80), view,
      category: CATEGORY_DEFAULTS[b.category] ? b.category : 'other', fabric: clampStr(b.fabric, 20), summary: clampStr(b.summary, 300),
      parts: (Array.isArray(b.parts) ? b.parts : []).slice(0, 12).map((x) => clampStr(x, 60)),
      palette: (Array.isArray(b.palette) ? b.palette : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6),
    };
    const image = provider === 'stability' ? await stabilityPhoto(args) : await geminiPhoto(args);
    return send(res, 200, { mode: 'ai', provider, view: provider === 'stability' ? 'front' : view, image });
  }

  if (m === 'POST' && p === '/api/products') {
    const b = await readJson(req);
    const mats = (Array.isArray(b.materials) ? b.materials : []).slice(0, 6)
      .map((x) => ({ material: clampStr(x?.name, 80), reason: clampStr(x?.reason, 200), query: clampStr(x?.search || x?.name, 100) })).filter((x) => x.material);
    const live = !!cfg().channel3Key;
    const groups = await Promise.all(mats.map(async (mt) => {
      let products = [], error = false;
      if (live) { try { products = await channel3Search(mt.query); } catch (e) { console.error('Channel3', e.message); error = true; } }
      return { ...mt, shopUrl: shopUrl(mt.query), products, error };
    }));
    return send(res, 200, { mode: live ? 'live' : 'demo', groups });
  }

  if (m === 'GET' && p === '/api/makers') {
    return send(res, 200, { makers: scoreMakers(url.searchParams.get('category') || 'other', (url.searchParams.get('tags') || '').split(',').filter(Boolean)) });
  }

  if (m === 'POST' && p === '/api/commissions') {
    const b = await readJson(req, 12 * 1024 * 1024);
    const maker = MAKERS.find((x) => x.id === b.makerId);
    if (!maker) throw fail(400, 'Unknown maker');
    if (!isImageDataUrl(b.design)) throw fail(400, 'Design image required');
    if (!b.brief || typeof b.brief !== 'object') throw fail(400, 'Brief required');
    const brief = normalizeBrief(b.brief, heuristicBrief({ title: b.title, notes: '', meta: { template: '', elements: [], colors: [], parts: [] } }));
    const payments = quoteFor(maker, brief);
    const com = {
      id: uid('c_'), title: clampStr(b.title || brief.title, 80), design: b.design, brief, maker: { id: maker.id, name: maker.name, place: maker.place, craft: maker.craft, turnaround: maker.turnaround },
      products: cleanGroups(b.products),
      preview: isImageDataUrl(b.preview) && b.preview.length < 4e6 ? b.preview : null, message: clampStr(b.message, 800), answers: clampStr(b.answers, 1500), total: payments.reduce((s, x) => s + x.amount, 0), currency: cfg().currency, payments,
      status: 'proposal', createdAt: new Date().toISOString(),
    };
    db.commissions[com.id] = com; saveDb();
    return send(res, 201, publicCommission(com));
  }

  let mt;
  if ((mt = p.match(/^\/api\/commissions\/([\w]+)$/)) && m === 'GET') {
    const com = db.commissions[mt[1]];
    if (!com) throw fail(404, 'Commission not found');
    return send(res, 200, publicCommission(com));
  }
  if ((mt = p.match(/^\/api\/commissions\/(\w+)\/payments\/(\w+)\/order$/)) && m === 'POST') {
    return send(res, 200, await createOrder(mt[1], mt[2]));
  }
  if ((mt = p.match(/^\/api\/commissions\/(\w+)\/payments\/(\w+)\/capture$/)) && m === 'POST') {
    const b = await readJson(req);
    return send(res, 200, await captureOrder(mt[1], mt[2], b.orderId));
  }
  throw fail(404, 'Not found');
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) { // video seeking (Safari requires Range support)
      const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong' });
    }
  });
}

module.exports = { createServer };

if (require.main === module) {
  const c = cfg();
  createServer().listen(c.port, () => {
    console.log(`\n  Fasheate running at http://localhost:${c.port}`);
    console.log(`  AI:       ${c.anthropicKey ? `Anthropic (${c.anthropicModel})` : c.geminiKey ? `Google Gemini (${c.geminiModel})` : 'DEMO mode (set GEMINI_API_KEY — free — or ANTHROPIC_API_KEY)'}`);
    console.log(`  Products: ${c.channel3Key ? 'Channel3 (live product search)' : 'DEMO mode (set CHANNEL3_API_KEY)'}`);
    console.log(`  Photos:   ${photoProvider() === 'stability' ? 'Stability AI (control/structure)' : photoProvider() === 'gemini' ? 'Google Gemini image' : 'DEMO mode (set STABILITY_API_KEY)'}`);
    console.log(`  Payments: ${paypalLive() ? 'PayPal Sandbox (Orders + Capture API)' : 'DEMO mode (set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)'}\n`);
  });
}
