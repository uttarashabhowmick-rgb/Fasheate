# Fasheate — Architecture & API integration

## Components

- **`public/`** — static single-page app (no build step). `app.js` holds four views (studio, brief, makers, commission) and a shared `state` object.
- **`server.js`** — one Node file: static server, JSON API, AI client, PayPal client, JSON persistence.
- **`data/db.json`** — created at runtime; holds commissions (gitignored).

## AI integration

`POST /api/analyze` receives a JPEG of the canvas, the title/notes, and `meta` measured on the client (template used, tools/motifs used, dominant colours computed from pixels). The server calls the Anthropic Messages API with:

- a **system prompt** that demands interpretation of the user's *own* design (not redesign) and a fixed JSON schema;
- a user turn containing the **image block** + the textual context.

The reply is parsed from the first `{` to the last `}` and passed through `normalizeBrief`, which enforces types, lengths, enums (category, complexity 1–5), colour hex format and falls back field-by-field to a heuristic brief. The answers to the maker questions are appended to the notes and re-analysed ("Refine").

Failure behaviour: missing key → demo brief (UI says "Demo brief"); API error or unparsable reply → demo brief plus a toast.

## PayPal integration (Sandbox)

```
Buyer clicks PayPal button
  → paypal.Buttons.createOrder  → POST /api/commissions/:id/payments/:pid/order
       server: POST {sandbox}/v2/checkout/orders  (intent CAPTURE, amount from stored quote,
               custom_id = commissionId:paymentId, PayPal-Request-Id idempotency key)
       returns order id; stored on the payment
  → buyer approves in PayPal popup
  → paypal.Buttons.onApprove    → POST /api/commissions/:id/payments/:pid/capture {orderId}
       server: verifies orderId === stored orderId
               POST {sandbox}/v2/checkout/orders/{id}/capture
               verifies status COMPLETED and captured amount == expected
               stores captureId, payer, timestamp; marks paid; updates commission status
```

OAuth2 client-credentials tokens are cached until shortly before expiry. The client secret never leaves the server; only the client ID is sent to the browser to load the JS SDK.

### Payment schedule

`quoteFor(maker, brief)` → `total = round(baseRate × (0.6 + 0.4 × complexity))`, split 30 / 40 / 30 (the last instalment absorbs rounding so the parts always sum to the total). A payment can only be ordered when all earlier ones are `paid`.

### Demo mode

If `PAYPAL_CLIENT_ID`/`SECRET` are not set, `createOrder`/`captureOrder` skip the network calls and generate `DEMO-…` identifiers. The UI shows an amber "Demo" banner so this can never be mistaken for a real PayPal capture.

## Security notes

- Static file server rejects paths that resolve outside `public/`.
- JSON body limit 6 MB; image data URLs validated by regex (png/jpeg/webp base64).
- Server-trusted pricing; client cannot set amounts.
- All AI/user text is rendered with `textContent` (no `innerHTML`).
- Prototype has no auth: commission IDs are unguessable random strings but act as bearer tokens. Add accounts before production.

## Extending

- Real maker profiles and a proposal/negotiation thread (replace `MAKERS` and the instant quote).
- PayPal Payouts / Commerce Platform to split funds to makers; webhooks (`PAYMENT.CAPTURE.COMPLETED`) for reconciliation.
- More categories beyond fashion/accessories (the template list and `CATEGORY_DEFAULTS` are the only fashion-specific parts).
