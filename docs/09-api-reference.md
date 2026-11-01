# 9. API Reference

See also: [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md) for key management and error codes, and [Configuration](04-configuration.md) for server settings.

## Overview

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Server status |
| `POST /generate-pdf` | none | Compile a template with data (used by the frontend) |
| `POST /v1/invoices` | token | One invoice → PDF |
| `POST /v1/invoices/bulk` | token | Many invoices → ZIP of PDFs |

## `GET /health`

```json
{ "status": "ok" }
```

## `POST /generate-pdf`

Compiles a minijinja + Typst template with the supplied data and returns a PDF. It accepts **arbitrary templates** and has **no authentication**: use it for the frontend and demos, and set `ENABLE_GENERATE_PDF=false` for external customers.

Request body (`application/json`, max 2 MB):

```json
{
  "template": "#set page(margin: 2.5cm)\n\nHello {{ name }}!",
  "data": { "name": "Max Mustermann" },
  "assets": { "logo": "<base64 image bytes>" }
}
```

`assets` is optional (max 8 entries, 1 MB each, alphanumeric keys). Each asset is available in the template as `{{ assets.<key> }}`, a virtual file path usable in `image(...)`; `data` must then be a JSON object.

Response `200`: `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="output.pdf"`, body = PDF bytes. Errors are JSON with a code and details (4xx for invalid payloads or templates, 5xx for compile failures).

### Where does the template come from?

The backend does not create it. It is the static file `frontend/src/template/invoice.typ` (Typst with minijinja placeholders such as `{{ settings.sender.name }}`). The frontend bundles it (`?raw` import) and `buildRequest()` in `frontend/src/lib/buildRequest.ts` puts it into every request as `template`, together with `data` (validated and escaped form values) and `assets` (logo as base64).

### Two different JSON files

| File | Button | Content | Use |
| --- | --- | --- | --- |
| `pdfcraft-config.json` | **Exportieren** | `{ schemaVersion, settings, invoice }` (raw form values) | Backup / re-import in the UI; accepted by `POST /v1/invoices` |
| `pdfcraft-request.json` | **API-Request** | `{ template, data, assets }` | Send as-is to `POST /generate-pdf` |

### Example and many invoices

```bash
curl -X POST http://localhost:3000/generate-pdf \
  -H 'content-type: application/json' \
  --data @pdfcraft-request.json -o invoice.pdf

for n in 1 2 3; do
  jq --arg n "2026-00$n" '.data.invoice.number = $n' pdfcraft-request.json \
    | curl -s -X POST http://localhost:3000/generate-pdf \
        -H 'content-type: application/json' --data @- -o "invoice-$n.pdf"
done
```

Rules for `data`: every text value is inserted into a Typst string literal, so `\` and `"` must be escaped as `\\` and `\"`. Units, tax rates, locale, font and color must be whitelisted values from `frontend/src/lib/types.ts`; this endpoint does not validate them. For customer integrations use `/v1`, which validates and escapes for you.

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
