# Purchased Tokens (Stripe)

Purchased tokens (`pk_…`) are for productive use: higher limits (by plan), no "Entwurf" watermark, a lifetime that follows what was bought. The feature is **off** by default (`PAID_TOKENS_ENABLED=false`): purchased tokens are rejected with `401`, and the Stripe endpoints answer `404`. Enable it when the product goes live.

Only the token is stored (SHA-256 hash of the secret, plan, limit, end date). No names, companies, e-mail addresses or payment data. After a token ran out it stays in Valkey for `PAID_TOKEN_RETENTION_DAYS` (default 365, so customers can renew it by its id) and is then deleted by Valkey itself.

> Status: implemented and tested with signed fake events (signature check, create, claim, renew, duplicates). It has **not** been tested against a live Stripe account; check the event fields below in Stripe's test mode first.

## Flow

```
Customer pays on Stripe Checkout ──> Stripe ──signed webhook──> POST /v1/stripe/webhook
                                                         │ creates / extends the token in Valkey
Customer lands on your success page ── GET /v1/tokens/claim?session_id=cs_… ──> token (once)
```

1. The backend verifies the `Stripe-Signature` header (HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`, 5 minute tolerance). Nothing happens without a valid signature.
2. `checkout.session.completed` with `payment_status=paid` creates a token. Every session is handled once, repeated events are ignored.
3. The plain token exists only at this moment. It is kept for one hour under the checkout session id and handed out **once** by `GET /v1/tokens/claim?session_id=cs_…` (`{token, expiresAt, plan, limitPerMinute}`). Your success page (`success_url` with `{CHECKOUT_SESSION_ID}`) calls it and shows the token. The session id is the secret; do not log it.

## Session metadata

Create the Checkout Session (or Payment Link) with these `metadata` keys:

| Key | Required | Meaning |
| --- | --- | --- |
| `plan` | new token | A name from `PAID_PLANS` (default `starter`, `business`, `pro`) |
| `days` | always | Lifetime in days, 1..=366 (for example `1` for a day pass, `30` for a month) |
| `token_id` | renewal | The id of an existing token (`pk_<id>_<secret>`); then the token is **extended** by `days` instead of a new one created |

Renewal by id (customers can do this when the token is about to run out): start a new Checkout with `metadata.token_id=<id>`; only after Stripe reports the payment as successful, the token is extended. Without a successful transaction nothing changes. The id alone grants nothing; it can only be used to pay for the token.

Plans and limits are server config (`PAID_PLANS=starter=60,business=300,pro=1000`, invoices per minute), not part of the request.

## Subscriptions

For `mode=subscription` the first checkout creates the token and remembers `subscription id → token id` in Valkey (no customer data). Each renewal arrives as `invoice.paid` with `billing_reason=subscription_cycle`; the token is then valid until the **paid period end plus `PAID_GRACE_DAYS`** (default 3). The grace period covers late payments and retries: Stripe invoices at the start of a billing period, so the payment normally arrives before the old period ends. If a payment fails, the token simply runs out after the grace period. A cancelled subscription needs no action; the token expires on its own.

## Enable it (checklist)

1. Stripe dashboard (start in test mode): create products/prices (day pass, month, subscription).
2. Webhook endpoint `https://<your-host>/v1/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`. Copy the signing secret (`whsec_…`).
3. Backend environment (Kubernetes: a Secret, for example via `backend.env` or an `existingSecret` extension):

   ```bash
   PAID_TOKENS_ENABLED=true
   STRIPE_WEBHOOK_SECRET=whsec_...
   PAID_PLANS=starter=60,business=300,pro=1000
   PAID_GRACE_DAYS=3
   ```
4. Add the `plan`/`days` metadata to your checkout sessions or payment links and a success page that calls the claim endpoint.
5. Try it with the Stripe CLI: `stripe listen --forward-to localhost:3000/v1/stripe/webhook` and a test payment; the CLI prints the signing secret to use locally.
6. Switch Stripe to live mode, replace the secret, and update the landing page text.

## Test locally without Stripe

```bash
export VALKEY_URL=redis://localhost:6379 PAID_TOKENS_ENABLED=true STRIPE_WEBHOOK_SECRET=whsec_test
cd backend && cargo run
```

Send a signed fake event (Python, standard library only):

```python
import hmac, hashlib, json, time, urllib.request
body = json.dumps({"type": "checkout.session.completed", "data": {"object": {
    "id": "cs_test_1", "payment_status": "paid",
    "metadata": {"plan": "starter", "days": "31"}}}}).encode()
t = int(time.time())
sig = hmac.new(b"whsec_test", f"{t}.".encode() + body, hashlib.sha256).hexdigest()
req = urllib.request.Request("http://localhost:3000/v1/stripe/webhook", body,
    {"Stripe-Signature": f"t={t},v1={sig}", "Content-Type": "application/json"})
print(urllib.request.urlopen(req).read())
```

```bash
curl 'http://localhost:3000/v1/tokens/claim?session_id=cs_test_1'   # token once, then 404
```

## Without Stripe

Tokens can always be managed by hand: `pdfcraft-backend tokens create --plan starter --days 30`, `tokens extend <id> --days 30` ([Tokens and Rate Limiting](05-tokens-and-rate-limiting.md)).
