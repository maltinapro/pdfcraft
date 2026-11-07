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
| `POST /v1/postage/stamps/bulk` | same body plus `quantity` (1 to 25); buys all stamps in **one cart with one login** (all or nothing). Response `{ "stamps": [{ "png", "widthMm", "heightMm", "voucherId", "shopOrderId" }], "productCode", "productName", "priceCents" (each), "totalCents", "walletBalanceCents" }`. Costs `4 + quantity` rate-limit tokens, so a free token (20 per minute) can buy at most 16 at once |
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

## Trying it out

For the production setup and go-live checklist see [Production](06-production.md#internetmarke-deutsche-post-stamps-optional).

Three ways, from safest to real money. All need the feature flag `INTERNETMARKE_ENABLED=true`, Valkey, and client credentials (any value for the mock).

| | Mock (no Post account) | Deutsche Post sandbox | Production |
| --- | --- | --- | --- |
| Needs | nothing | developer portal app + sandbox Portokasse/test wallet | onboarding, real Portokasse |
| Cost | free | test money | real postage |
| `INTERNETMARKE_SHIPPING_URL` | `http://127.0.0.1:9100/im/v1` | sandbox URL from the portal | empty (default) |
| `INTERNETMARKE_PRODUCTS_URL` | `http://127.0.0.1:9100/products` | sandbox URL if given | empty (default) |
| Login in the form | any e-mail, password `secret` | sandbox login | your own Portokasse login |
| Result | checkerboard placeholder | sandbox stamp | valid, billed stamp |

**Real stamps (sandbox first):**

1. Register at the DHL developer portal, create an app and subscribe to "Deutsche Post INTERNETMARKE"; the app's client id/secret are `INTERNETMARKE_CLIENT_ID`/`INTERNETMARKE_CLIENT_SECRET`.
2. Have a Portokasse with credit (or a sandbox test wallet via Deutsche Post support) and authorize the application there ("Meine Daten -> Geschäftsanwendungen", secondhand information); otherwise the login is rejected with 401.
3. Start the backend (or Compose, see below) with the variables above, buy a stamp in the form, download the PDF and print it at 100 % into a window envelope. Check size, position and that the code scans before sending real mail.
4. Report anything that differs from the spec (product list, download link, ZIP pairing; see "Open points").

**Where to run it:** natively (`cargo run` + `npm run dev`, see [Local development](02-local-development.md)) or with Docker Compose (see [Docker](03-docker-local.md)). Compose passes the four `INTERNETMARKE_*` variables to the backend; the optional `mock-post` service (profile `mock`) is the mock below. Without `--profile mock`, Compose talks to the real URLs you configured.

## Testing without Deutsche Post

`backend/tools/mock_internetmarke.py` is a local stand-in for both Deutsche Post APIs (products, login, cart, PNG checkout, ZIP download; password `secret`, `poor@example.com` has only 1 EUR). Start it, point `INTERNETMARKE_SHIPPING_URL=http://127.0.0.1:9100/im/v1` and `INTERNETMARKE_PRODUCTS_URL=http://127.0.0.1:9100/products` at it, and set `INTERNETMARKE_ENABLED=true` with any client id/secret (see the header of the script). Plain `http://` is accepted **only** for `localhost`/`127.0.0.1`; any other shipping URL requires https for the API and the download link. The unit tests start a similar mock server in-process (`cargo test internetmarke`).

With Docker Compose the mock is the optional `mock-post` service (profile `mock`). It shares the backend's network namespace, because plain http is only accepted for loopback addresses:

```bash
INTERNETMARKE_ENABLED=true INTERNETMARKE_CLIENT_ID=id INTERNETMARKE_CLIENT_SECRET=secret \
INTERNETMARKE_SHIPPING_URL=http://127.0.0.1:9100/im/v1 \
INTERNETMARKE_PRODUCTS_URL=http://127.0.0.1:9100/products \
docker compose --profile mock up --build
```

Open http://localhost:8080/app/ (solve the Anubis challenge), pick a document and use any e-mail with the password `secret` in the "Internetmarke" section. For the real sandbox or production API, set the same variables with real credentials (and the sandbox URL) and leave out `--profile mock`. Verified: the mock is reachable from the backend's namespace; `docker compose` itself was not run (plugin missing in the development environment).

## Stamp dimensions

The stamp (`voucherLayout=FRANKING_ZONE`, 300 dpi PNG) is placed 1:1: width/height in mm = pixels / dpi x 25.4 (dpi from the PNG `pHYs` chunk when it is plausible, otherwise 300), never rescaled. Reference sizes measured from real purchases by the public dataset [gruncellka/porto-data](https://github.com/gruncellka/porto-data) (`marks.json`; third-party, not an official Deutsche Post specification):

| Stamp | Pixels | Size |
|---|---|---|
| domestic | 437 x 236 | 37 x 20 mm |
| international, registered | 732 x 236 | 62 x 20 mm |
| registered international | 732 x 384 | 62 x 32.5 mm |
| `ADDRESS_ZONE` label (not used) | 1004 x 508 | 85 x 43 mm |

All fit the 85 x 40 mm limit in `postage.rs` (a unit test pins these sizes). Stamps up to 20 mm high fit the DIN 5008 franking zone; the 32.5 mm high one is taller, so the templates grow the address block (`max(47.4 mm, height + 20 mm)`) instead of letting the recipient overlap the reference line; the content below moves down accordingly. Reported placement rules (secondhand, not verified against the official documents): the PNG contains only the stamp, without any A4 frame; on an envelope the stamp belongs to the top right corner, and an area of about 74 x 40 mm there must stay free of other text, lines and graphics so the sorting machines can read the DataMatrix code (this matches the envelope placement in `marks.json`, 74 x 40 mm flush right at the top). PDFCraft prints into the DIN 5008 window, so the stamp is seen through the window of the envelope and the free area is the stamp area in the address field: nothing else may be placed next to or over it. The reported "35-45 x 25-35 mm" size is a rough estimate and contradicts the measured 37 x 20 mm; the measured values are used. The official Deutsche Post rules (clear zone, placement) could not be read from the development environment and are still to be compared with a physical print.

## Open points

Summary, ordered by risk (details below):

| # | Open point | Blocks go-live? | How to close it |
| --- | --- | --- | --- |
| 1 | Does Deutsche Post allow partner apps to use end-customer Portokasse logins? (else reseller model) | yes | Ask Deutsche Post during onboarding |
| 2 | Is a franking mark inside the address window (top right of the address field) accepted for window envelopes? Fallback: `ADDRESS_ZONE` (85 x 43 mm label with address), which would send the recipient address to Deutsche Post and must be weighed against "no customer data in the backend" | yes | Physical print test, ask the business customer service |
| 3 | Official rules (clear zone, placement, size) not read; sizes come from a third-party dataset | yes | Read the Deutsche Post documentation, compare with a printed stamp |
| 4 | Live behaviour: product filter, download host, ZIP image/voucher pairing, real PNG size/dpi | yes | Run the flow against the sandbox ("Trying it out") |
| 5 | A stamp that was paid but not downloaded (`postage_download_failed`): can it be fetched again in the Portokasse? | no | Test in the sandbox/Portokasse |
| 6 | Privacy policy and Impressum wording for Deutsche Post and the login pass-through | yes | Operator/legal review |
| 7 | Browser UI buys single stamps only; archive entries are reproduced without a stamp | no | By design, bulk via the API |
| 8 | `docker compose` itself was not run (plugin missing in the development environment); only the mock's network setup was verified | no | Run the Compose example in "Trying it out" |


- **Onboarding:** production credentials come with a Deutsche Post partner onboarding. Whether a partner app may log in with *end-customer* Portokasse credentials in production must be clarified with Deutsche Post. If not, a reseller model (users pay PDFCraft via Stripe, PDFCraft pays from its own wallet) would replace the credentials dialog; the stamp handling in templates and browser stays the same.
- **Spec check (v1.30):** the request/response shapes were compared with the official OpenAPI file `pp-post-internetmarke.yaml` v1.30 (`POST /user` form fields incl. `grant_type=client_credentials`, `access_token`, `walletBalance`; `POST /app/shoppingcart`; `POST /app/shoppingcart/png?directCheckout=true` with `type`, `shopOrderId`, required `total`, `dpi`, `optimizePNG`, positions with `positionType`/`productCode`/`voucherLayout`; response `link`, `shoppingCart`, `walletBallance`). Everything matches. The spec describes the app resource as selling stamps from "an individual cash account assigned to the end customer", which fits the Portokasse-login model; it also states that the production username/password come with the onboarding and that sandbox defaults exist. The Portokasse password is limited to 22 characters (longer ones are rejected upstream as a failed login). The spec says nothing about stamp size or clear zones.
- **Portokasse app authorization (secondhand):** users reportedly have to authorize the business application once in the Portokasse under "Meine Daten -> Geschäftsanwendungen"; otherwise the login fails with 401. Tell users this in onboarding material; a failed login already shows the friendly "login rejected" message. Sandbox test wallets are reportedly arranged through Deutsche Post support.
- **Disregarded information:** a further third-party summary names `POST /v1/user/bind`, a `userToken` in the payload, `AddressZone`, a 40 x 30 mm stamp and a stamp at 8-10 mm from the top right of the A4 page. This contradicts the official spec v1.30 (`POST /user`, bearer `access_token`, `FRANKING_ZONE`/`ADDRESS_ZONE`) and the measured sizes, so it was not used. Its 74 x 40 mm free zone agrees with the other source. Printing the stamp at the top right of the page would hide it inside a folded window-envelope letter; PDFCraft prints it in the address field (window) instead. Whether the Post accepts this position (window franking) must be confirmed by the physical print test.
- **Live check:** run the flow against the sandbox. The product filter (letter names; products come from the separate Products API, the spec only says the product code comes from ProdWS or the price lists), the download link host and the ZIP image/voucher pairing are not covered by the spec.
- **Print test:** the layout rules of the franking mark are binding. Print the PDF at 100 % and test it in a window envelope; the placement in the address field was checked visually only (with the reference sizes above rasterized, not printed).
- **Bulk / API-only use:** the document bulk endpoints accept a `postage` per entry but never buy stamps themselves. API clients buy `n` stamps with `POST /v1/postage/stamps/bulk` and attach one to each entry (example in the [API reference](09-api-reference.md)). The images are paired with the voucher ids by their file number in the download (`0.png`, `1.png`, ...); this pairing follows the spec and is not verified against the live service. If the number of images differs from the number of stamps, the call fails with `postage_download_failed` and the shop order id. The browser UI buys single stamps only; reproduced archive entries have no stamp.
- **Legal:** the privacy policy names Deutsche Post as an external service and describes the pass-through of the login. The operator must verify the wording.
