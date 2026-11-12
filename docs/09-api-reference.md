# 9. API Reference

See also: [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md) for key management and error codes, and [Configuration](04-configuration.md) for server settings.

## OpenAPI specification

[`openapi.yaml`](openapi.yaml) (OpenAPI 3.1) describes `POST /v1/invoices`, `/v1/invoices/bulk`, `/v1/documents`, `/v1/documents/bulk`, `GET /v1/token`, the two ways to send the token (`Authorization: Bearer <token>` or `X-API-Key`), `Retry-After` on `429`/`503` and the error envelope with its codes. The purchase, Mollie webhook, free-token and postage endpoints are not part of it yet. Use it to generate a client (for example with [OpenAPI Generator](https://openapi-generator.tech/)) or to try requests.

- **Interactive reference:** the frontend build publishes the spec as `/api/openapi.yaml` and renders it with a self-hosted Swagger UI at `/api/` (no external requests; with `docker compose up --build` at http://localhost:8080/api/, with `npm run dev` at http://localhost:5173/api/). "Try it out" sends the requests to the host that serves the page.
- **Quickstart:** `curl -X POST https://digitalrechnung.jetzt/v1/invoices -H 'Authorization: Bearer YOUR_TOKEN' -H 'content-type: application/json' --data @pdfcraft-config.json -o invoice.pdf` (examples below).
- **Kept in sync:** the request examples of the spec are posted through the validation and rendering code by the test `openapi_request_examples_are_accepted` (`backend/src/v1.rs`), and `openapi_enums_match_the_validation` compares the allowed values (fonts, units, tax rates, locales, profiles, document types, length limits) with the code. CI also lints the file with Redocly (`npx @redocly/cli@2.78.0 lint docs/openapi.yaml --max-problems 0`, rules in `redocly.yaml`). When you change a field, limit or error code of one of these endpoints, change the spec in the same PR.

## Overview

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Server status |
| `POST /v1/free-token` | Anubis pass | Issue a free token (used by the frontend), see [guide 11](11-free-token-and-anubis.md) |
| `POST /v1/checkout` | none | Starts a Mollie payment for an offer from `PAID_PRICES` (only with `PAID_TOKENS_ENABLED`), see [guide 12](12-paid-tokens-mollie.md) |
| `POST /v1/mollie/webhook` | none (payment is fetched from Mollie) | Creates/extends purchased tokens (only with `PAID_TOKENS_ENABLED`) |
| `GET /v1/tokens/claim` | order id | Hands out a purchased token once after payment |
| `GET /v1/checkout/offers` | none | Offers for the purchase page; `{"enabled": false}` when purchases are not configured |
| `GET /v1/token` | any token | Plan, limit, end date and `subscription` flag of the calling token |
| `POST /v1/subscription/cancel` | purchased token | Cancels the Mollie subscription of the token (stays valid until its end) |
| `POST /v1/invoices` | token | One invoice → PDF |
| `POST /v1/invoices/bulk` | token | Many invoices → ZIP of PDFs |
| `POST /v1/documents/bulk` | token | Many documents of one type → ZIP of PDFs |
| `GET /v1/postage/products` | token | Deutsche Post products and prices (optional feature, see [guide 14](14-internetmarke-integration.md)) |
| `POST /v1/postage/stamps`, `/stamps/bulk` | token | Buy one or up to 25 stamps with the user's own Portokasse login (free tokens may use test stamps) |
| `POST /v1/postage/stamps/recover` | token | Fetch a paid but undelivered stamp again, no new charge |

## `GET /health`

```json
{ "status": "ok" }
```

## `POST /v1/free-token`

Issues a free token (`pf_…`) to a browser that solved the Anubis challenge. No body. Response `200`: `{ "token", "expiresAt" (unix seconds), "limitPerMinute" }`. `403 challenge_required` without a valid Anubis cookie, `409 already_issued` if the cookie was already exchanged, `503 free_token_disabled` if `ANUBIS_PUBLIC_KEY_HEX` is not set. Details: [Free Token and Anubis](11-free-token-and-anubis.md).

## Purchased tokens

`POST /v1/checkout`, `POST /v1/mollie/webhook` (called by Mollie) and `GET /v1/tokens/claim?order=…` (called by your success page) answer `404` unless purchases are enabled (`PAID_TOKENS_ENABLED=true` plus `MOLLIE_API_KEY`, `PUBLIC_URL`, `MOLLIE_REDIRECT_URL` and `PAID_PRICES`); `GET /v1/checkout/offers` then answers `{"enabled": false}` and `POST /v1/subscription/cancel` answers `404`.

`GET /v1/token` answers `{ kind, id, plan, limitPerMinute, bulkMax, expiresAt, subscription }` (`bulkMax` = documents per bulk request). `POST /v1/subscription/cancel` answers `{ "cancelled": true }`, `404 no_subscription` if none runs, `502 payment_upstream_error` if Mollie fails.

`POST /v1/checkout` takes `{ "plan", "days", "subscription"?, "tokenId"?, "locale"? }` and answers `200 { "checkoutUrl", "order" }`; redirect the customer to `checkoutUrl`. Errors: `400 unknown_offer` (not in `PAID_PRICES`), `400 unknown_token` (`tokenId` does not exist), `503 mollie_not_configured`, `502 payment_upstream_error`. Details: [Purchased Tokens (Mollie)](12-paid-tokens-mollie.md).

## Postage stamps (Internetmarke)

`GET /v1/postage/products` and `POST /v1/postage/stamps` buy a Deutsche Post stamp with the user's own Portokasse login; the PNG is passed back via the optional `invoice.postage` / `document.postage` field (`{ "base64": "<PNG>" }`) of `/v1/invoices` and `/v1/documents`. Nothing is stored. Both answer `404 postage_disabled` while `INTERNETMARKE_ENABLED=false`. Details: [Internetmarke](14-internetmarke-integration.md).

API-only flow (no frontend):

```bash
# 1. list products (letter products with price in cents)
curl -H 'Authorization: Bearer <token>' http://localhost:3000/v1/postage/products
# 2. buy one stamp; the response contains "png" (base64)
curl -X POST http://localhost:3000/v1/postage/stamps -H 'Authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{"productCode":1,"expectedPriceCents":95,"requestId":"<unique per purchase>",
       "credentials":{"username":"portokasse@example.com","password":"..."}}'
# 3. put the PNG into the document: "postage": {"base64": "<png>"}
```

`POST /v1/postage/stamps/bulk` buys up to 25 stamps with one login in one cart (all or nothing); the body is the same as above plus `"quantity": n`, the response has a `stamps` array (`png`, `voucherId`, ...). It costs `4 + quantity` rate-limit tokens (a single purchase costs 5).

With a free token and a configured test API (`INTERNETMARKE_SANDBOX_*`), the products response has `"sandbox": true` and `"loginRequired": false` and `credentials` may be omitted: you get a test stamp, nothing is charged (see [guide 14](14-internetmarke-integration.md)).

If a purchase answers `postage_download_failed` (the money was spent, the image could not be downloaded), `POST /v1/postage/stamps/recover` with `{ "shopOrderId": "<id from the error details>", "credentials": {...} }` returns the stamps again without buying anything (2 rate-limit tokens).

The document bulk endpoints (`/v1/invoices/bulk`, `/v1/documents/bulk`) accept `postage` per entry but never buy stamps: buy the stamps first and attach one to each entry. A stamp is valid for one letter only. The 2 MB request limit applies, so split large bulk requests with stamps into several calls.

## `POST /v1/invoices`

For external customers. The template lives on the server (the same `invoice.typ`, compiled into the binary), so clients send only invoice data. Input is validated and escaped by the server (`backend/src/invoice.rs`); all problems are returned together as `400 validation_error`.

**Authentication:** `Authorization: Bearer <key>` or `X-API-Key: <key>`. Missing or invalid: `401`. Over the limit: `429` with `Retry-After`. No key source configured: `503`.

**Body:** the same JSON as the config export (`settings` + `invoice`; extra fields such as `schemaVersion` and item `id` are ignored).

- Required: `settings.sender.{name,address,city}`, `invoice.{number,date,recipient.{name,address,city},items}`.
- Allowed values (fonts, locales, units, tax rates `19/7/0`, profiles `en16931`/`xrechnung`): see `frontend/src/lib/types.ts`.
- Do **not** escape text yourself.
- The logo is `settings.logo.base64` (max 1 MB decoded).
- The optional handwritten signature is `settings.signature.base64` (PNG, JPEG, SVG or PDF recognised by content, max 300 KB decoded; invalid files give `400 validation_error` for `settings.signature`). It is printed below the closing text of every document type (letters: between closing and sender name). A PDF is converted to SVG (first page) and cropped to its visible content, because Typst cannot embed PDFs in PDF/A exports. It is an image, not a cryptographic signature.

```bash
curl -X POST http://localhost:3000/v1/invoices \
  -H 'Authorization: Bearer <key>' -H 'content-type: application/json' \
  --data @pdfcraft-config.json -o invoice.pdf
```

## `POST /v1/documents`

Credit note (Stornorechnung), offer, order confirmation, delivery note and letter. Same authentication, rate limit (one token per PDF), watermark rules and error format as `/v1/invoices`.

**Body:** `{ "type": "...", "settings": { ... }, "document": { ... } }`

| `type` | Required `document` fields | Notes |
| --- | --- | --- |
| `credit-note` | `number`, `date`, `recipient`, `items`, `reference` (cancelled invoice) | Quantities are shown negative automatically; optional `referenceDate`, `reason`, `closing`. With `settings.zugferd` the PDF carries an EN 16931 / XRechnung credit-note XML (TypeCode 381, positive amounts, reference to the cancelled invoice); recipient `vatId`, `email`, `buyerReference` are used for it |
| `offer` | `number`, `date`, `recipient`, `items` | Optional `validUntil`, `reference`, `intro`, `closing` |
| `order` | `number`, `date`, `recipient`, `items` | Optional `deliveryDate`, `reference`, `intro`, `closing` |
| `delivery-note` | `number`, `date`, `recipient`, `items` | No prices; optional `deliveryDate`, `reference`, `intro`, `closing` |
| `letter` | `date`, `recipient`, `subject`, `body` | Optional `reference`, `closing` (e.g. "Mit freundlichen Grüßen") |

`recipient` is `{ name, address, city }`, items are `{ description, quantity, unit, price, taxRate }` like in invoices, dates are `YYYY-MM-DD`. Only `settings.sender`, the logo, accent color, font, locale and footer are used. Unknown `type` → `400 invalid_request`.

```bash
curl -X POST http://localhost:3000/v1/documents \
  -H 'Authorization: ******' -H 'content-type: application/json' \
  -d '{"type":"letter","settings":{"sender":{"name":"Muster GmbH","address":"Musterstr. 1","city":"12345 Musterstadt"}},"document":{"date":"2026-11-03","recipient":{"name":"Kunde AG","address":"Kundenweg 5","city":"54321 Kundenstadt"},"subject":"Hallo","body":"Sehr geehrte Damen und Herren,\n\n...","closing":"Mit freundlichen Grüßen"}}' \
  -o letter.pdf
```

## `POST /v1/documents/bulk`

Body `{ "type": "offer", "settings": {...}, "documents": [ {...}, ... ] }` (each entry as in `/v1/documents`). Returns a ZIP of PDFs, costs one rate-limit token per document and is capped by `BULK_MAX_INVOICES`. Any validation error rejects the whole request.

## `POST /v1/invoices/bulk`

Many invoices with shared settings → ZIP.

```bash
curl -X POST http://localhost:3000/v1/invoices/bulk \
  -H 'Authorization: Bearer <key>' -H 'content-type: application/json' \
  --data @bulk.json -o invoices.zip
```

`bulk.json`:

```json
{ "settings": { "...": "..." },
  "invoices": [ { "number": "...", "date": "2026-10-29", "recipient": { "...": "..." }, "items": [ "..." ] } ] }
```

The ZIP contains `invoice-<number>.pdf` per invoice. If one invoice fails, nothing is returned and the error names it (`invoices[3]: ...`). At most `BULK_MAX_BY_PLAN` invoices per request for the token's plan (default free 5, starter 25, business/pro 100, never above `BULK_MAX_INVOICES`), otherwise `400 invalid_request`; each costs one rate-limit token, so a bulk request also has to fit into the token's per-minute limit.
