# 9. API Reference

See also: [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md) for key management and error codes, and [Configuration](04-configuration.md) for server settings.

## OpenAPI specification

[`openapi.yaml`](openapi.yaml) (OpenAPI 3.1) describes `POST /v1/invoices`, `/v1/invoices/bulk`, `/v1/documents`, `/v1/documents/bulk`, `GET /v1/token`, `GET /v1/version`, the `X-Pdfcraft-Version` header, the two ways to send the token (`Authorization: Bearer <token>` or `X-API-Key`), `Retry-After` on `429`/`503` and the error envelope with its codes. The purchase, Mollie webhook, free-token and postage endpoints are not part of it yet. Use it to generate a client (for example with [OpenAPI Generator](https://openapi-generator.tech/)) or to try requests.

- **Interactive reference:** the frontend build publishes the spec as `/api/openapi.yaml` and renders it with a self-hosted Swagger UI at `/api/` (no external requests; with `docker compose up --build` at http://localhost:8080/api/, with `npm run dev` at http://localhost:5173/api/). "Try it out" sends the requests to the host that serves the page.
- **Quickstart:** `curl -X POST https://digitalrechnung.jetzt/v1/invoices -H 'Authorization: Bearer YOUR_TOKEN' -H 'content-type: application/json' --data @pdfcraft-config.json -o invoice.pdf` (examples below).
- **Generated from the code:** `openapi.yaml` is not written by hand. The paths, request and response schemas, field limits and the allowed values (fonts, units, tax rates, locales, profiles, document types) are generated from the Rust types and handlers (`utoipa` derives and `#[utoipa::path]`, assembled in `backend/src/openapi.rs`); the allowed values come from the constants of the validation. The introduction, the shared error responses and the request examples live in `backend/src/openapi_overlay.yaml`. After changing a field, limit or endpoint, regenerate the file with `cd backend && cargo test openapi_file_is_up_to_date` (rewrites `docs/openapi.yaml` locally) or `cargo run -- openapi > ../docs/openapi.yaml`, and commit it. CI fails (the same test, `CI` is set there) when the committed file is outdated, so nobody has to edit it manually.
- **Tested:** the request examples are posted through the validation and rendering code by `openapi_request_examples_are_accepted` (`backend/src/v1.rs`), `openapi_limits_match_the_validation` compares the length and item limits written into the schema attributes with the constants, and `openapi_lists_every_error_code` checks that every error code of the handlers is documented. CI also lints the file with Redocly (`npx @redocly/cli@2.78.0 lint docs/openapi.yaml --max-problems 0`, rules in `redocly.yaml`).

## Overview

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Server status |
| `POST /v1/free-token` | Anubis pass | Issue a free token (used by the frontend), see [guide 11](11-free-token-and-anubis.md) |
| `POST /v1/checkout` | none | Starts a Mollie payment for an offer from `PAID_PRICES` (only with `PAID_TOKENS_ENABLED`), see [guide 12](12-paid-tokens-mollie.md) |
| `POST /v1/mollie/webhook` | none (payment is fetched from Mollie) | Creates/extends purchased tokens (only with `PAID_TOKENS_ENABLED`) |
| `GET /v1/tokens/claim` | order id | Hands out a purchased token once after payment |
| `GET /v1/checkout/offers` | none | Offers for the purchase page; `{"enabled": false}` when purchases are not configured |
| `GET /v1/version` | none | Version, git commit, Typst version and template hashes of the running backend, see [Version information](#version-information) |
| `GET /v1/token` | any token | Kind (`free`, `paid`, `service`), plan, limit, end date (`null` for service tokens) and `subscription` flag of the calling token |
| `POST /v1/subscription/cancel` | purchased token | Cancels the Mollie subscription of the token (stays valid until its end) |
| `POST /v1/invoices` | token | One invoice → PDF |
| `POST /v1/invoices/bulk` | token | Many invoices → ZIP of PDFs |
| `POST /v1/documents/bulk` | token | Many documents of one type → ZIP of PDFs |
| `GET /v1/postage/products` | token | Deutsche Post products and prices (optional feature, see [guide 14](14-internetmarke-integration.md)) |
| `POST /v1/postage/stamps`, `/stamps/bulk` | token | Buy one or up to 25 stamps with the user's own Portokasse login (free tokens may use test stamps) |
| `POST /v1/postage/stamps/recover` | token | Fetch a paid but undelivered stamp again, no new charge |

## Version information

Every response of the backend (PDFs, ZIPs and errors) carries `X-Pdfcraft-Version: <release version>`. `GET /v1/version` needs no token, costs no rate-limit unit and answers

```json
{
  "version": "1.4.0",
  "commit": "5f3a9c1d2b7e4a60918c3d5e7f1a2b4c6d8e0f12",
  "typst": "0.15.1",
  "templateHash": "9b1e4c7a…",
  "templates": { "invoice": "4e7b0d3a…", "credit-note": "2c5f8b1e…", "offer": "6a9d2c5f…" }
}
```

`version` is the release tag of the image (build arg `APP_VERSION`, the crate version for local builds), `commit` the git SHA (`APP_COMMIT`, `unknown` for local builds). `templates` holds the SHA-256 of the complete Typst source (shared layout plus body) per document type, `templateHash` one hash over all of them, so a changed template is visible even if the version number is not bumped. A client that stores issued documents can keep this answer (or `X-Pdfcraft-Version` plus `templates.<type>`) with the input of each document as render snapshot. The same handler is also served at `GET /version` on the backend itself; the Helm ingress forwards only `/v1`. Browsers can read the header cross-origin (`Access-Control-Expose-Headers`).

## Deterministic PDF output

The same input rendered by the same PDFCraft build gives a **byte-identical PDF** (same SHA-256), also after a restart of the backend, at any time and in any order of requests. This lets a client that stores the hash of an issued PDF re-render it from its stored input during an audit and compare.

How it is achieved:

- The PDF creation and modification date (document info and XMP) come from the **document date** of the request (`invoice.date` or `document.date`), never from the clock; the time is always `00:00:00Z`.
- Typst derives the PDF document and instance ID (`/ID`, `xmpMM:DocumentID`/`InstanceID`) from the document content, so they are stable too.
- The Factur-X XMP post-processing and the e-invoice XML (`einvoice.rs`) contain no time stamps, random values or request counters; the XML file inside the PDF is only built from the input.
- Nothing is cached between requests (no rendered PDF, no template result), so a render never depends on earlier requests.

Test coverage: `pdf_output_is_identical_for_identical_input` and `pdf_output_is_identical_across_processes` (`backend/src/v1/tests.rs`, run by `cargo test` in CI) render an invoice (EN 16931 and XRechnung profile) and every other document type in every design, each with and without watermark and with a logo, three times in one process and in two freshly started processes, and compare the SHA-256 of every PDF. They also check that the dates equal the document date.

Limits of the guarantee (the result may change when any of these changes, so keep them with the render snapshot):

- **PDFCraft version and templates.** A new release can change the layout or the PDF structure. Store `X-Pdfcraft-Version` and `templates.<type>` from [`GET /v1/version`](#version-information) with each document and re-render with the same build (container image tag).
- **Typst, `typst-pdf` and other dependencies.** Upgrades change the PDF bytes even for unchanged templates; the version answer contains the Typst version.
- **Fonts.** The backend embeds its fonts and also loads the fonts installed on the system (the Docker image installs some). A different font set, for example another base image or a custom `settings.font` that resolves to a different installed font, changes the layout. Use the same image for re-rendering.
- **Input.** Every input value counts, including the logo, signature and stamp bytes, `settings.design`, the locale and the watermark (free tokens and `options.watermark = "draft"` add "Entwurf"/"Draft"). The date is required for every document type, so the output does not depend on "today".
- **Platform.** The test runs on one platform (CI, linux/amd64); identical output on other CPU architectures (e.g. arm64 images) is expected but not verified.

## `GET /health`

```json
{ "status": "ok" }
```

## `POST /v1/free-token`

Issues a free token (`pf_…`) to a browser that solved the Anubis challenge. No body. Response `200`: `{ "token", "expiresAt" (unix seconds), "limitPerMinute" }`. `403 challenge_required` without a valid Anubis cookie, `409 already_issued` if the cookie was already exchanged and its token was revoked or has expired (a repeated request with the same cookie otherwise returns the same token again), `503 free_token_disabled` if `ANUBIS_PUBLIC_KEY_HEX` is not set. Details: [Free Token and Anubis](11-free-token-and-anubis.md).

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
- Optional invoice dates: `serviceDate` or the pair `serviceDateFrom` / `serviceDateTo`; `dueDate` overrides the due date derived from `settings.paymentDays`. Omitting them preserves the previous defaults (service date = invoice date, due date = invoice date + payment term).
- Allowed values (fonts, locales, units, tax rates `19/7/0`, profiles `en16931`/`xrechnung`): see `frontend/src/lib/types.ts`.
- Do **not** escape text yourself.
- The logo is `settings.logo.base64` (max 1 MB decoded).
- The optional handwritten signature is `settings.signature.base64` (PNG, JPEG, SVG or PDF recognised by content, max 300 KB decoded; invalid files give `400 validation_error` for `settings.signature`). It is printed below the closing text of every document type (letters: between closing and sender name). A PDF is converted to SVG (first page) and cropped to its visible content, because Typst cannot embed PDFs in PDF/A exports. It is an image, not a cryptographic signature.

```bash
curl -X POST http://localhost:3000/v1/invoices \
  -H 'Authorization: Bearer <key>' -H 'content-type: application/json' \
  --data @pdfcraft-config.json -o invoice.pdf
```

Every `POST` endpoint (`/v1/invoices`, `/v1/invoices/bulk`, `/v1/documents`, `/v1/documents/bulk`) accepts an optional body field `"options": { "watermark": "draft" }`. It prints the diagonal "Entwurf" / "Draft" watermark (by document language) on every PDF of the request, for any token, so previews of unreleased documents cannot be mistaken for issued ones. Free tokens always keep the watermark, with or without the option. Other values give `400 invalid_request`; nothing is stored.

The browser preview adds `?zones=1` to single-document requests. This optional flag adds an `X-Pdfcraft-Zones` response header containing zone 3/4 rectangles as JSON (`zone`, one-based `page`, `x`, `y`, `w`, `h` in mm). The header is omitted without the flag; the browser positions zones 1/2 from the fixed DIN layout. Bulk endpoints are unchanged.

## `POST /v1/documents`

Credit note (Stornorechnung), offer, order confirmation, delivery note, letter and dunning letter (Mahnung). Same authentication, rate limit (one token per PDF), watermark rules and error format as `/v1/invoices`.

**Body:** `{ "type": "...", "settings": { ... }, "document": { ... } }`

| `type` | Required `document` fields | Notes |
| --- | --- | --- |
| `credit-note` | `number`, `date`, `recipient`, `items`, `reference` (cancelled invoice) | Quantities are shown negative automatically; optional `referenceDate`, `reason`, `closing`. With `settings.zugferd` the PDF carries an EN 16931 / XRechnung credit-note XML (TypeCode 381, positive amounts, reference to the cancelled invoice); recipient `vatId`, `email`, `buyerReference` are used for it |
| `offer` | `number`, `date`, `recipient`, `items` | Optional `validUntil`, `reference`, `intro`, `closing` |
| `order` | `number`, `date`, `recipient`, `items` | Optional `deliveryDate`, `reference`, `intro`, `closing` |
| `delivery-note` | `number`, `date`, `recipient`, `items` | No prices; optional `deliveryDate`, `reference`, `intro`, `closing` |
| `letter` | `date`, `recipient`, `subject`, `body` | Optional `reference`, `closing` (e.g. "Mit freundlichen Grüßen") |
| `dunning` | `number`, `date`, `recipient`, `dunningLevel`, `invoices`, `paymentDeadline` | Dunning letter, see below |

`recipient` is `{ name, address, city }`, items are `{ description, quantity, unit, price, taxRate }` like in invoices, dates are `YYYY-MM-DD`. Only `settings.sender`, the logo, accent color, font, locale and footer are used (and `settings.bank` for the `dunning` payment block). Unknown `type` → `400 invalid_request`.

### Dunning letter (`dunning`)

References one or more open invoices and asks for payment until a new deadline. It is laid out in all three designs and in German or English (`settings.locale`) and has the payment block of the invoice (account, `Verwendungszweck` = the dunning `number`, EPC QR code with the total when `settings.bank.iban` is valid). The PDF carries no e-invoice XML. The dunning letter is available through the API only; the configurator has no tile or form for it, because dunning belongs to the calling accounting system (for example FediFinance).

| Field | Meaning |
| --- | --- |
| `dunningLevel` | `1` payment reminder (Zahlungserinnerung), `2` dunning letter (Mahnung), `3` final dunning letter (Letzte Mahnung); selects the title and the default text |
| `invoices` | 1 to 100 open invoices: `number`, `date`, `dueDate` (not before `date`) and the still open gross amount `openAmount` (> 0) |
| `fees` | optional, up to 20 lines `{ description, amount }` (e.g. dunning fee), amount ≥ 0 |
| `interest` | optional default interest (§ 288 BGB), either calculated by PDFCraft from the base rate (`debtor`) or passed by you (`rate`, `from`, `to`, `amount`); see below |
| `paymentDeadline` | new payment deadline, not before `date`; shown in the info block and in the payment text |
| `intro`, `closing` | optional; without `intro` a default text for the level is printed |

PDFCraft does not invent fees: the caller passes them. The total claim (sum of the open amounts, fees and interest, computed in cents) is printed and is the amount of the payment block and the QR code. Validation errors are reported with the path, e.g. `document.invoices[0].openAmount`.

#### Default interest from the base rate

With `interest.debtor` (`consumer`: base rate + 5 percentage points, § 288 Abs. 1 BGB; `business`: + 9 percentage points, § 288 Abs. 2 BGB) PDFCraft calculates the interest per invoice:

- The interest starts the day after the due date (or at `interest.from`) and ends on the document date (or at `interest.to`); both days count. Days are counted actual/365. Amounts are computed in whole cents and rounded half up per invoice.
- The period is **split by day at every change of the base rate** (1 January and 1 July). The PDF lists each part with its days, base rate and rate (`base + premium`), the principal and the amount, and prints the base rate (§ 247 BGB), the premium and a note that default interest is damages and not subject to VAT.
- The base rates are data, not code: `backend/src/data/base-rates.json` has `valid_from`, `valid_to`, `base_rate` (fraction, `0.0152` = 1.52 %) and `source_ref` for every period since 2002-01-01 (§ 247 BGB; taken from the Bundesbank table, the workflow `base-rate-check.yml` compares it weekly, and daily in the first week of January and July, with the Bundesbank series `BBIN1.M.DE.BBK.BBKBAS2.EUR.ME (SU0115)` via `backend/tools/check_base_rates.py`; it fails on a difference or when the table no longer covers today, and it is not a pull request check). The environment variable `BASE_RATES` adds or replaces half-years without a new build (see [Configuration](04-configuration.md)), and `interest.baseRate` (percent, e.g. `1.77`) replaces the table for one document. A period that is not covered by the table is a validation error, never a silently reused rate. Add every new half-year. For business debtors (`debtor: "business"`) the premium is 9 points; for obligations that arose before 2014-07-29 it was 8 points (§ 288 para. 2 BGB, old version), so a calculation that starts before that date is rejected and must be sent as manual interest.
- With `debtor` you must not send `rate` or `amount`.

Without `debtor` nothing is calculated: `rate` (percent per year), `from`, `to` and `amount` are required and printed as given.

#### Record for the books (GoBD)

PDFCraft is stateless and stores nothing, so the caller freezes the result:

- For calculated interest the PDF carries the attachment **`dunning-interest.json`** (schema `pdfcraft.dunning-interest/1`): document number and date, legal basis, debtor type, premium, day count, and per invoice the principal, the periods (`from`, `to`, `days`, base rate, rate, source of the rate) and the interest, plus the total. Keep the PDF (and the JSON) as the unchangeable document. The same input and the same base rate table give the same PDF byte for byte, but a later change of the table must never recalculate a document that was sent; to reprint it, send the stored values in the manual form (`rate`, `from`, `to`, `amount`).
- Default interest is damages and not subject to VAT. In your books it belongs on an interest income account without tax automatic (e.g. SKR03 2650 / SKR04 7100, check with your tax advisor), not into the invoice. If you show it in an e-invoice it is a line outside VAT, tax category `O` (outside the scope) or `E` (exempt), not a taxable line.
- Interest and fees are ancillary claims: keep them as their own open items, not as part of the original invoice. Partial payments are applied to costs first, then to interest, then to the principal (§ 367 BGB); the PDF says so, your accounting has to do it.

```json
{"type":"dunning","settings":{"sender":{"name":"Muster GmbH","address":"Musterstr. 1","city":"12345 Musterstadt"},"bank":{"iban":"DE89370400440532013000"}},
 "document":{"number":"M-2026-002","date":"2026-08-10","dunningLevel":2,"paymentDeadline":"2026-08-24",
  "recipient":{"name":"Kunde AG","address":"Kundenweg 5","city":"54321 Kundenstadt"},
  "invoices":[{"number":"R-2026-001","date":"2026-06-02","dueDate":"2026-06-16","openAmount":1000}],
  "fees":[{"description":"Mahngebühr","amount":5}],"interest":{"debtor":"business"}}}
```

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
