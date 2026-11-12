# Fasheate — From Imagination to Reality

> **You imagine it. You create it. We'll help you bring it to life.**

Fasheate is a human-first, AI-powered creative commerce platform. Sketch an idea (an outfit, a bag, a strange chair — it doesn't have to be finished), let AI interpret *your* drawing into a production brief, find an independent maker, and commission the work with **PayPal** deposits and milestone payments.

Built for the **Build What's Next with PayPal and AI** hackathon.

> *An idea doesn't have to be finished to become real.*

## Home page & demo video

The app opens on a landing page (`public/index.html`, `#home`) with the wordmark, a demo video (`public/demo.mp4`) and calls to action leading into Create → Develop → Collaborate → Commission. The video was recorded by driving the real UI with Playwright; replace `public/demo.mp4` and `public/demo-poster.jpg` with your own recording any time.

## The journey

| Step | What happens | Tech |
|---|---|---|
| 1. **Create** | Start from a **realistic garment** (dress, jacket, bag, shoe, hat, chair) rendered with fabric texture, lighting, folds, stitching and hardware. Tap any part (sleeves, sole, collar…) to colour it, choose a fabric (cotton, denim, silk, leather, wool knit), then add motifs and freehand lines — or upload your own image. | HTML5 canvas layers (`public/garments.js`) |
| 2. **Develop** | AI reads the drawing + notes and returns a structured brief: components, palette, materials, build steps, complexity, lead time, clarifying questions, improvements and easier alternatives. Answer the questions and refine. | Gemini (free) or Anthropic vision API |
| 2b. **See it in real life** | One click turns the design into a photoreal product photo (front, ¾, side, back) that you can drag to rotate like a turntable; the front photo is attached to the commission so the maker sees it. | Gemini image model (`gemini-2.5-flash-image`) |
| 3. **Collaborate** | Makers are ranked against the brief's category and skill tags; send the brief and a message to request a proposal. | Skill-tag matching |
| 4. **Commission** | Maker proposes a quote split into a 30% deposit, a 40% sample-approved milestone and a 30% delivery payment, each paid through PayPal in order. | PayPal Checkout, Orders API, Capture API (Sandbox) |

## Quick start

Requires **Node 18+**. There are **no npm dependencies** — nothing to install.

```bash
git clone <your-repo-url> fasheate && cd fasheate
cp .env.example .env        # optional: add keys (see below)
npm start                   # → http://localhost:3000
npm test                    # smoke tests (demo mode, no network)
```

Without keys the app runs in **demo mode**, clearly labelled in the UI: the AI brief is template-based and payments are simulated locally. This lets anyone try the whole flow instantly.

### Add your API keys (all optional — each one switches a feature from demo to live)

Create a file named `.env` next to `server.js` (copy `.env.example`), paste your keys after the `=` signs, save, and restart with `npm start`. The header badges and the terminal show which services are live. Never commit `.env` (it is already in `.gitignore`).

| Key in `.env` | Feature it turns on | Where to get it |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal Sandbox checkout (Orders + Capture API) | [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox) → Apps & Credentials → Sandbox → create app |
| `CHANNEL3_API_KEY` | Real products to buy for each material (Step 2) | Channel3 dashboard (sign up at channel3.ai, create an API key) |
| `STABILITY_API_KEY` | Photoreal render of your design (Step 3) | [platform.stability.ai](https://platform.stability.ai/account/keys) → Account → API keys |
| `GEMINI_API_KEY` *(free)* | AI production brief; also photo previews if no Stability key | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `ANTHROPIC_API_KEY` *(paid, optional)* | Alternative for the AI brief | console.anthropic.com |

Notes: free credits and quotas for Channel3 and Stability are set by those companies and can change — check each dashboard. Stability charges credits per image. If a key is missing or a service fails, the app keeps working in demo mode and says so.

### Turn on real PayPal Sandbox payments

1. Go to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox) → **Apps & Credentials** → **Sandbox** → create an app.
2. Copy its **Client ID** and **Secret** into `.env` as `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
3. Restart. The header badge changes to **PayPal: sandbox** and the checkout step renders the real PayPal Buttons.
4. Pay with a **sandbox personal (buyer) account** from *Dashboard → Testing Tools → Sandbox Accounts*. No real money moves.

### Turn on real AI (free option)

1. Open [Google AI Studio](https://aistudio.google.com/apikey), sign in and click **Create API key** (free tier, no card).
2. Put it in `.env` as `GEMINI_API_KEY=...` and restart. The header badge changes to **AI: live**.
3. Prefer Anthropic? Set `ANTHROPIC_API_KEY` instead (paid); it takes priority if both are set.

**Photo previews** use the same `GEMINI_API_KEY`. The image model's free-tier availability and quota are set by Google and can change; if it is unavailable the app says so and keeps working (demo mode shows your design with a 3D tilt instead). Override the model with `GEMINI_IMAGE_MODEL`.

The image of the user's own drawing is sent to the model with their notes; the reply is validated and normalised server-side before it reaches the UI. If the call fails, the app falls back to the template brief and says so.

## Architecture

```
Browser (public/)                    Node server (server.js)                 External
┌──────────────────────┐   JSON      ┌───────────────────────────┐
│ Studio canvas        │──/api/analyze──▶ aiBrief() ────────────────────────▶ Anthropic Messages API
│ Brief / Makers views │──/api/makers───▶ scoreMakers()            │
│ Commission view      │──/api/commissions──▶ quoteFor() + JSON db │
│ PayPal JS SDK Buttons│──/…/order──────▶ createOrder()  ──────────────────▶ PayPal POST /v2/checkout/orders
│                      │──/…/capture────▶ captureOrder() ──────────────────▶ PayPal POST /v2/checkout/orders/{id}/capture
└──────────────────────┘             └───────────────────────────┘
```

Key design decisions (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- **The server owns the money.** Amounts are computed server-side from the stored quote; the browser can only ask to pay a specific payment. Clients never send prices.
- **Ordered milestones.** A payment can't be ordered until the previous one is captured.
- **Capture is verified.** The server checks the order ID matches the one it created, that PayPal reports `COMPLETED`, and that the captured amount equals the expected amount before marking anything paid.
- **AI output is untrusted.** It's parsed, clamped and whitelisted (`normalizeBrief`), and the UI renders it with `textContent` only.
- **No dependencies.** Plain `node:http`, `fetch`, and a JSON file store (`data/db.json`) keep the prototype easy to run and audit.

## API

| Method & path | Purpose |
|---|---|
| `GET /api/config` | PayPal client ID (if configured) and mode flags |
| `POST /api/analyze` | `{image, title, notes, meta}` → `{brief, mode}` |
| `POST /api/products` | `{materials}` → real products per material via Channel3 (or shop-search links in demo mode) |
| `POST /api/photo` | `{image, view, title, category, fabric, parts, palette}` → `{mode, image}` photoreal preview |
| `GET /api/makers?category=&tags=` | Makers ranked by match |
| `POST /api/commissions` | Create a commission + payment schedule |
| `GET /api/commissions/:id` | Fetch a commission |
| `POST /api/commissions/:id/payments/:pid/order` | **PayPal Orders API** — create order |
| `POST /api/commissions/:id/payments/:pid/capture` | **PayPal Capture API** — capture approved order |

## 3-minute demo script

1. **0:00** – Pick *Jacket*, fill it, stamp a few motifs, name it, add a note.
2. **0:40** – *Develop with AI*: show the brief, answer a question, hit *Refine*.
3. **1:20** – *Find makers*: show the match ranking, request a proposal.
4. **1:50** – Pay the deposit through PayPal Sandbox; show the receipt and that milestone 2 is now unlocked.
5. **2:30** – Recap: create → AI → maker → PayPal.

## Hackathon checklist

- [x] Meaningful PayPal integration — Checkout Buttons, Orders API, Capture API, Sandbox
- [x] Meaningful AI integration — vision-based design interpretation and production brief
- [x] Working prototype — studio, AI, makers, payments
- [x] Technical documentation — this README + `docs/ARCHITECTURE.md`
- [x] Open-source licence — MIT (`LICENSE`)
- [ ] Push to a public GitHub repository
- [ ] Hosted URL or keep the local setup instructions above
- [ ] Record a public YouTube demo under 3 minutes

## Prototype scope & honesty notes

- The seven makers are **sample data**, not real people. Maker onboarding, proposal negotiation, messaging and escrow/payout to makers are out of scope for the prototype; payments are captured to the platform's sandbox merchant account.
- The "milestone" approvals are represented by payment order, not by a maker-confirmation workflow.
- Storage is a JSON file; use a real database before any production use.

## Licence

MIT © Fasheate contributors
