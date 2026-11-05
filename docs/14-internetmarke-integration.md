# 14. Internetmarke (Deutsche Post stamps)

Users buy a postage stamp (Internetmarke) with **their own Portokasse account**, and the DataMatrix franking mark is printed into the address field of the generated PDF (invoice and all other document types). Off by default (`INTERNETMARKE_ENABLED=false`).

Based on the Deutsche Post *INTERNETMARKE API* OpenAPI spec v1.27 (`https://api-eu.dhl.com/post/de/shipping/im/v1`). The DHL developer portal was not reachable from the development environment and the integration was **not run against the live sandbox**: product filter, response field names and the download host must be checked there first (see "Open points").

## Privacy: nothing is stored

PDFCraft keeps no customer data, and the stamp purchase follows the same rule:

- The Portokasse login is sent over TLS in the body of one request, used for the `POST /user` call at Deutsche Post and dropped. It is never logged, cached or put in a metric (the `Credentials` type has no `Debug`/`Clone`/`Serialize`).
- The access token, the stamp PNG and the voucher id live only in that request; the browser receives the PNG and stores it in its own draft (`localStorage`, without credentials).
- Valkey only gets a hashed one-time request marker (15 minutes) that prevents a double purchase on a repeated click. The public product list (names, prices) is cached in memory for an hour.
- Recipient addresses are **not** sent to Deutsche Post (the stamp is bought as `FRANKING_ZONE` without an address).
- Logs and metrics contain only the outcome, product code, price, token id and duration.

The password is also not kept in the browser: it is only held in component state and cleared after each purchase.

## Flow

1. `GET /v1/postage/products`: letter products with gross price (from the Deutsche Post products API, profile `IM-PARTNER`; never from the client). 1 rate-limit token.
2. The user selects a product, enters the Portokasse e-mail and password and confirms the price.
3. `POST /v1/postage/stamps` (5 rate-limit tokens): logs in (`POST /user`, OAuth client credentials of the PDFCraft app plus the Portokasse login), creates a cart, buys one stamp (`POST /app/shoppingcart/png?directCheckout=true`, 300 dpi) and downloads the PNG immediately (https only, no auth header, 2 MB cap, ZIP or PNG). The price is re-checked against the list (`409 postage_price_changed`).
4. The browser stores the stamp in the draft and sends it with the document as the optional `postage` field (`{ "base64": "..." }`). The backend validates it (PNG signature, size, dimensions) and places it as a per-request asset in the DIN 5008 address field; the recipient moves below it.
5. After the PDF download the stamp is cleared from the draft (**a stamp is valid once**). The archive keeps only voucher id, product and price, not the PNG.

If the payment succeeded but the download failed, the error `postage_download_failed` names the shop order id so the user can fetch the stamp in the Portokasse.

## Backend API

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/postage/products` | `{ "products": [{ "productCode", "name", "priceCents" }] }` |
| `POST /v1/postage/stamps` | body `{ "productCode", "expectedPriceCents", "requestId", "credentials": { "username", "password" } }`; response `{ "png" (base64), "widthMm", "heightMm", "voucherId", "shopOrderId", "productCode", "productName", "priceCents", "walletBalanceCents" }` |

Both need a token (free or paid) and answer `404 postage_disabled` while the feature is off. Error codes: `postage_login_failed` (422, deliberately not 401), `postage_wallet_insufficient` (402), `postage_price_changed` / `postage_duplicate` (409), `postage_unknown_product` (400), `postage_download_failed`, `postage_upstream_error` (502). The frontend translates them in `frontend/src/lib/apiErrors.ts`.

`POST /v1/invoices` and `POST /v1/documents` accept the optional `postage` field (`invoice.postage` / `document.postage`).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `INTERNETMARKE_ENABLED` | `false` | Feature flag |
| `INTERNETMARKE_CLIENT_ID`, `INTERNETMARKE_CLIENT_SECRET` | empty | App credentials of the DHL developer portal (Internetmarke API enabled). Secrets: keep them out of images and values files |
| `INTERNETMARKE_SHIPPING_URL` | `https://api-eu.dhl.com/post/de/shipping/im/v1` | Shipping API base URL (set the sandbox URL for tests) |
| `INTERNETMARKE_PRODUCTS_URL` | DP products API | Products API URL |

Helm: `backend.env.INTERNETMARKE_ENABLED: "true"` plus `backend.internetmarkeSecret` (a Secret with the keys `INTERNETMARKE_CLIENT_ID` and `INTERNETMARKE_CLIENT_SECRET`). The backend needs outbound HTTPS to `api-eu.dhl.com` (the image contains `ca-certificates`).

Metric: `pdfcraft_postage_stamps_total{result}` (dashboard "Internetmarke purchases by result", see [Observability](13-observability.md)).

## Open points

- **Onboarding:** production credentials come with a Deutsche Post partner onboarding. Whether a partner app may log in with *end-customer* Portokasse credentials in production must be clarified with Deutsche Post. If not, a reseller model (users pay PDFCraft via Stripe, PDFCraft pays from its own wallet) would replace the credentials dialog; the stamp handling in templates and browser stays the same.
- **Live check:** run the flow against the sandbox. The product filter (letter names), the response fields (`walletBalance`/`walletBallance`, `voucherList`) and the download link host are derived from the spec and sample code.
- **Print test:** the layout rules of the franking mark are binding. Print the PDF at 100 % and test it in a window envelope; the placement in the address field was checked visually only.
- **Bulk:** `POST /v1/documents/bulk` does not buy stamps; reproduced archive entries have no stamp.
- **Legal:** the privacy policy names Deutsche Post as an external service and describes the pass-through of the login. The operator must verify the wording.
