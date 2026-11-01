# 9. API Reference

See also: [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md) for key management and error codes, and [Configuration](04-configuration.md) for server settings.

## Overview

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Server status |
| `POST /v1/free-token` | Anubis pass | Issue a free token (used by the frontend), see [guide 11](11-free-token-and-anubis.md) |
| `POST /v1/invoices` | token | One invoice → PDF |
| `POST /v1/invoices/bulk` | token | Many invoices → ZIP of PDFs |

## `GET /health`

```json
{ "status": "ok" }
```

## `POST /v1/free-token`

Issues a free token (`pf_…`) to a browser that solved the Anubis challenge. No body. Response `200`: `{ "token", "expiresAt" (unix seconds), "limitPerMinute" }`. `403 challenge_required` without a valid Anubis cookie, `409 already_issued` if the cookie was already exchanged, `503 free_token_disabled` if `ANUBIS_PUBLIC_KEY_HEX` is not set. Details: [Free Token and Anubis](11-free-token-and-anubis.md).

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
