# 9. API Reference

See also: [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md) for key management and error codes, and [Configuration](04-configuration.md) for server settings.

## Overview

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Server status |
| `POST /v1/free-token` | Anubis pass | Issue a free token (used by the frontend), see [guide 11](11-free-token-and-anubis.md) |
| `POST /v1/stripe/webhook` | Stripe signature | Creates/extends purchased tokens (only with `PAID_TOKENS_ENABLED`), see [guide 12](12-paid-tokens-stripe.md) |
| `GET /v1/tokens/claim` | session id | Hands out a purchased token once after payment |
| `POST /v1/invoices` | token | One invoice → PDF |
| `POST /v1/invoices/bulk` | token | Many invoices → ZIP of PDFs |
| `POST /v1/documents/bulk` | token | Many documents of one type → ZIP of PDFs |

## `GET /health`

```json
{ "status": "ok" }
```

## `POST /v1/free-token`

Issues a free token (`pf_…`) to a browser that solved the Anubis challenge. No body. Response `200`: `{ "token", "expiresAt" (unix seconds), "limitPerMinute" }`. `403 challenge_required` without a valid Anubis cookie, `409 already_issued` if the cookie was already exchanged, `503 free_token_disabled` if `ANUBIS_PUBLIC_KEY_HEX` is not set. Details: [Free Token and Anubis](11-free-token-and-anubis.md).

## Purchased tokens

`POST /v1/stripe/webhook` (called by Stripe) and `GET /v1/tokens/claim?session_id=cs_…` (called by your success page) answer `404` while `PAID_TOKENS_ENABLED=false`. Details: [Purchased Tokens (Stripe)](12-paid-tokens-stripe.md).

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

The ZIP contains `invoice-<number>.pdf` per invoice. If one invoice fails, nothing is returned and the error names it (`invoices[3]: ...`). At most `BULK_MAX_INVOICES` invoices per request; each costs one rate-limit token.
