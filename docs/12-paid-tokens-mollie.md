# Purchased Tokens (Mollie)

Purchased tokens (`pk_…`) are for productive use: higher limits (by plan), no "Entwurf" watermark, a lifetime that follows what was bought. The feature is **off** by default. Purchases are active only when **all** of `PAID_TOKENS_ENABLED=true`, `MOLLIE_API_KEY`, `PUBLIC_URL`, `MOLLIE_REDIRECT_URL` and at least one `PAID_PRICES` offer are set. If one is missing, the checkout, webhook, claim, offers and cancel endpoints answer `404` and the frontend shows no purchase page (purchased tokens are then rejected with `401`). Enable it when the product goes live.

Only the token is stored by PDFCraft (SHA-256 hash of the secret, plan, limit, end date). No names, companies, e-mail addresses or payment data; Mollie keeps the payments (and an empty customer object for subscriptions). After a token ran out it stays in Valkey for `PAID_TOKEN_RETENTION_DAYS` (default 365, so customers can renew it by its id) and is then deleted by Valkey itself.

> Status: implemented and tested against a local mock of the Mollie API (`backend/tools/mock_mollie.py`: checkout, webhook, claim, renewal, subscription, duplicates). It has **not** been tested against a live Mollie account; check it in Mollie's test mode (`test_…` key) first.

## Flow

```
Customer ── POST /v1/checkout {plan, days} ──> backend ── create payment ──> Mollie
         <── {checkoutUrl, order} ──────────────┘
Customer pays on Mollie ──> Mollie ── POST /v1/mollie/webhook (id=tr_…, unsigned) ──> backend
                                                    │ GET /payments/tr_… with MOLLIE_API_KEY
                                                    │ creates / extends the token in Valkey
Customer lands on MOLLIE_REDIRECT_URL?order=… ── GET /v1/tokens/claim?order=… ──> token (once)
```

1. `POST /v1/checkout` accepts only offers from `PAID_PRICES` (`plan:days=amount`, for example `starter:31=2.90`). It creates a Mollie payment with the metadata `plan`, `days`, `order` (a random secret for the claim) and optionally `token_id`, and returns Mollie's `checkoutUrl`. Redirect the customer there. The endpoint is public (no token) so that customers with an expired token can renew; put a rate limit in front of it (Ingress) if it is reachable from the internet.
2. Mollie calls `POST /v1/mollie/webhook` with only `id=tr_…`; there is **no signature**. The backend therefore never trusts the request itself: it fetches the payment from the Mollie API and acts only on `status=paid` and the metadata written by the checkout. Unknown payments and payments without PDFCraft metadata are ignored. Every payment is handled once; repeated calls are harmless. If handling fails the backend answers with an error and Mollie retries.
3. The plain token exists only at this moment. It is kept for one hour under the `order` id and handed out **once** by `GET /v1/tokens/claim?order=…` (`{token, expiresAt, plan, limitPerMinute}`). Your success page (`MOLLIE_REDIRECT_URL`, Mollie sends the customer there; `?order=<id>` is appended) calls it and shows the token. The order id is the secret; do not log it.

## Renewal

`POST /v1/checkout` with `tokenId=<id>` (the id in `pk_<id>_<secret>`) creates a payment that **extends** that token by `days` once Mollie reports it as paid. The id must belong to an existing paid token (also an expired one still in retention). The id alone grants nothing; it can only be used to pay for the token. Without a successful payment nothing changes.

## Subscriptions

`POST /v1/checkout` with `"subscription": true` creates an empty Mollie customer and a *first* payment (`sequenceType=first`), which gives the mandate. After that payment is paid and the token is created, the backend creates a Mollie subscription that charges the same amount every `days` days, starting `days` days later. The subscription metadata keeps the token id (no customer data). Each paid `recurring` charge arrives at the webhook; the backend reads the token id from the subscription and moves the token's end to **now + `days` + `PAID_GRACE_DAYS`** (default 3). The grace period covers late payments and retries. If a charge fails, the token simply runs out after the grace period. Customers cancel in the frontend (**Buy a token** page, authenticated with their token) or via `POST /v1/subscription/cancel`; the backend then deletes the Mollie subscription (the id is kept in Valkey as `pdfcraft:mollie:sub-of:<token id>`, no customer data). The token stays valid until its end. You can also cancel in the Mollie dashboard.

Plans and limits are server config (`PAID_PLANS=starter=30,business=100,pro=300`, invoices per minute), not part of the request.

## Pricing

Prices are pure configuration (`PAID_PRICES`, `PAID_PLANS`); no code change is needed to change them. Suggested offers (prices incl. VAT, EUR); start with Starter only and add Business with one more `PAID_PRICES` entry when needed:

| Offer | `PAID_PRICES` | Launch price | Later price |
| --- | --- | --- | --- |
| Starter, 31 days (one-off or subscription) | `starter:31=` | 2.90 | 4.90 |
| Starter, year (365 days) | `starter:365=` | 24.00 | 39.00 |
| Business, 31 days (100 documents/min, bulk up to 100 documents), for API/bulk use | `business:31=` | 9.90 | 14.90 |

**Browser vs. API/bulk:** Starter is meant for the browser (editor, preview, archive ZIP; the archive download splits into several ZIP files when it exceeds the plan's bulk size and waits for the rate limit between parts). Business is the plan for scripts and software integrations (higher limit, bulk up to 100 documents); sell it as an extra offer once there is demand. Very large customers (`pro`) get a token manually with `pdfcraft-backend tokens create --plan pro`.

There is no day pass: the free token covers trying it out, and Mollie's fees (a fixed amount plus a percentage) make very small one-off payments unattractive. The `pro` plan is defined in `PAID_PLANS` but not sold. A running subscription keeps the amount it was created with (the Mollie subscription holds it, see the terms, item 5); one-off renewals pay the price valid at that time, so raising the prices later does not affect existing subscribers. The subscription interval is sent to Mollie as `<days> days`. Mollie's API allows up to one year (`365 days`, per the `interval` field description of the official SDK), so the yearly offer also works as a subscription; longer terms would be rejected.

## Frontend purchase page

`GET /v1/checkout/offers` (public) returns `{"enabled": false}` or `{enabled, currency, offers:[{plan, days, amount, limitPerMinute}]}`. The frontend (`#/buy`, link "Buy a token") appears only when `enabled` is true. It lists the offers (optionally as subscription), sends the customer to Mollie, and after the redirect (`MOLLIE_REDIRECT_URL?order=…`) polls `GET /v1/tokens/claim` until the webhook arrived. The token is shown once and kept in the browser (`localStorage` `pdfcraft.paidToken`); it is used instead of the free token while valid. The page also shows plan, limit and end date (`GET /v1/token`, authenticated), renews the token (`tokenId` checkout), and cancels the subscription. The page is built around one token per browser: without a stored token it shows the offers and the card "Already bought a token?"; with a stored token it shows only the token and "Renew" (with the subscription option), and a collapsed section "Buy another plan or a new token" (a newly bought token replaces the stored one; it also holds the re-entry field). If the browser data was deleted, the saved token can be entered again in the card "Already bought a token?" (checked with `GET /v1/token`, then stored again; the token cannot be recovered if it was not saved). Set `MOLLIE_REDIRECT_URL` to the app URL (`https://<your-host>/app/`).

Users without a valid purchased token see a dismissible hint on the dashboard and in the editor ("Free version: PDFs carry the Draft watermark. Buy a token …") that links to `#/buy`; it is only shown when purchases are enabled (`FreeVersionHint.tsx`).

## Legal texts

`frontend/agb.html` (terms), `frontend/widerruf.html` (withdrawal policy with the model form) and the Mollie section of `frontend/datenschutz.html` belong to the shop; they are linked in the landing page footer and on the purchase page. The purchase page requires two checkboxes (accept terms; request immediate start and acknowledge the loss of the withdrawal right) and labels the buttons "Zahlungspflichtig kaufen/verlängern" (§ 312j BGB button solution). The terms (items 3 and 6) and the purchase page state that no e-mail with the order confirmation or the token is sent: the token is shown once after payment and must be saved at once. The cancel button on the purchase page serves as the cancellation button (§ 312k BGB).

The texts point out that the payment provider Mollie B.V. is a European company based in Amsterdam (Netherlands, EU) and therefore subject to the GDPR; keep this statement in sync with the provider.

These texts are drafts based on common German templates and the facts in this repository, **not legal advice**. Before go-live have them reviewed and check in particular: the seller (maltina.pro UG (haftungsbeschränkt) i. G., Düsseldorf; Vorneweg only supports and hosts the cluster), the missing imprint details (managing director, register data once entered, VAT ID), VAT wording (small-business rule or not), willingness to take part in consumer arbitration, the address for the withdrawal, and the order confirmation on a durable medium (§ 312f BGB; PDFCraft collects no e-mail address, so Mollie's payment receipt or an own confirmation must cover this).

## Enable it (checklist)

1. Mollie dashboard (start with the test API key): enable the payment methods you want. Subscriptions need methods that support mandates (card, PayPal, SEPA direct debit).
2. Backend environment (Kubernetes: a Secret for the API key via `backend.mollieSecret`, the rest via `backend.env`):

   ```bash
   PAID_TOKENS_ENABLED=true
   MOLLIE_API_KEY=test_...
   PUBLIC_URL=https://<your-host>             # Mollie must reach <PUBLIC_URL>/v1/mollie/webhook
   MOLLIE_REDIRECT_URL=https://<your-host>/app/   # success page, calls the claim endpoint
   PAID_PRICES=starter:31=2.90,starter:365=24.00
   PAID_PLANS=starter=30,business=100,pro=300
   PAID_GRACE_DAYS=3
   ```
3. Try it with a public URL (Mollie cannot call `localhost`; use a tunnel such as `cloudflared` or `ngrok` for `PUBLIC_URL`) and a Mollie test payment.
4. Switch to the live API key (`live_…`) and update the privacy policy/landing page text if needed.

## Test locally without Mollie

`backend/tools/mock_mollie.py` mimics the API pieces used here and calls the webhook like Mollie does:

```bash
python3 backend/tools/mock_mollie.py 9200 &
export VALKEY_URL=redis://localhost:6379 PAID_TOKENS_ENABLED=true MOLLIE_API_KEY=test_mock \
  MOLLIE_API_URL=http://127.0.0.1:9200/v2 PUBLIC_URL=http://127.0.0.1:3000 \
  MOLLIE_REDIRECT_URL=http://127.0.0.1:3000/app/ PAID_PRICES=starter:31=2.90
cd backend && cargo run
```

```bash
curl -s -XPOST localhost:3000/v1/checkout -H 'content-type: application/json' \
  -d '{"plan":"starter","days":31}'          # {"checkoutUrl": ".../tr_mock000001", "order": "…"}
curl -XPOST localhost:9200/pay/tr_mock000001   # "pays" and calls the webhook
curl 'localhost:3000/v1/tokens/claim?order=<order>'   # token once, then 404
# subscription: checkout with "subscription":true, pay it, then
curl -XPOST localhost:9200/renew/<subscription id>    # a recurring charge extends the token
```

`MOLLIE_API_URL` may only point to a non-https URL on loopback.

### With Docker Compose (full flow in the browser)

The Compose profile `mock` starts `mock-mollie` next to the stack. It shares the backend's network namespace (plain http is only allowed on loopback, same trick as `mock-post`) and is exposed through the `edge` proxy under `/mock-mollie/`. `deploy/compose/mock-mollie.env` switches on the purchase flow with the mock:

```bash
docker compose --env-file deploy/compose/mock-mollie.env --profile mock up --build
```

1. Open http://localhost:8080/app/ and click "Buy a token" (the link only appears when Mollie is enabled).
2. Pick an offer, tick both consent boxes and buy. You land on the mock checkout (`http://localhost:8080/mock-mollie/checkout/<id>`); "Pay" calls the webhook like Mollie and redirects back to the app, which claims and shows the token.
3. For subscriptions tick the subscription box, pay, then press "Simulate renewal" on http://localhost:8080/mock-mollie/ (a recurring charge extends the token). Cancel in the buy page.

Prices come from `PAID_PRICES` in the env file; `PAID_PLANS` (rate limits) can be overridden the same way. Use `docker compose ... down -v` to reset Valkey.

## Without Mollie

Tokens can always be managed by hand: `pdfcraft-backend tokens create --plan starter --days 30`, `tokens extend <id> --days 30` ([Tokens and Rate Limiting](05-tokens-and-rate-limiting.md)).
