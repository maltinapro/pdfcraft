# 14. Internetmarke Integration (Proposal)

**Status: design proposal, not implemented.** Based on the Deutsche Post *INTERNETMARKE API* OpenAPI spec v1.27 (`https://api-eu.dhl.com/post/de/shipping/im/v1`). The DHL developer portal was not reachable from the development environment, so every detail below must be re-checked against the portal and the sandbox before building.

Goal: a user buys a postage stamp (Internetmarke) for a letter or invoice, and the DataMatrix franking mark is printed straight onto the generated PDF.

## What the API really looks like

Corrections to the common first sketch (`/user/login`, `X-IBM-Client-*` headers, `/shoppingcart/pay`):

| Step | Call | Notes |
| --- | --- | --- |
| Token | `POST /user` (`application/x-www-form-urlencoded`) | body: `grant_type=client_credentials`, `client_id`, `client_secret` (DHL developer portal app) **and** `username`, `password` (Internetmarke/Portokasse account). Returns a Bearer token; all later calls use `Authorization: Bearer`. |
| Catalog | `GET /app/catalog?types=PUBLIC,PAGE_FORMATS` | product codes (`productCode`), motifs, page formats. Prices come from the catalog / downloadable price lists (PPL). Never hard-code prices. |
| Wallet | `PUT /app/wallet?amount=<cent>` | tops up the Portokasse wallet of the authenticated account (partner API). |
| Buy | `POST /app/shoppingcart/png?directCheckout=true` | body `AppShoppingCartPNGRequest`: `positions[]` (`productCode`, `voucherLayout: FRANKING_ZONE` or `ADDRESS_ZONE`, optional `address`), `total` (cent, must match), `shopOrderId` (max 18 chars), `dpi` (`DPI300`/`DPI203`), `optimizePNG`. Response: `link` (download of the stamp image(s)), `shoppingCart.voucherList` (voucher ids), `walletBallance`. |
| Preview | same endpoint with `?validate=true` | returns a thumbnail link, **no Authorization header and no purchase**. |
| Version | `GET /` | health check, no auth. |

There is a sandbox with default credentials. A PDF variant (`/app/shoppingcart/pdf`) exists but is a finished page layout; the PNG is the right input for our templates.

## Who pays: two models

The API is a **partner API**: production credentials are issued during onboarding with Deutsche Post. Whether a partner may log in with *end-customer* Portokasse credentials is not stated in the spec and must be clarified with Deutsche Post before choosing.

| | A. Bring your own account | B. Reseller |
| --- | --- | --- |
| Payment | User pays from their own Portokasse | User pays PDFCraft (Stripe), PDFCraft pays from its own wallet |
| Credentials | User's Internetmarke login passes through our backend (TLS, memory only, never stored or logged) | Only our own partner login (server secret) |
| Money / risk | None for us | Prepaid wallet, refunds, VAT and legal questions for reselling postage |
| Needs | Portal app + onboarding | Portal app + reseller contract + accounting/tax clarification |
| Fits our principles | Credentials of a third party are sensitive; contradicts "no customer data retained" only if stored | Better UX, more operational burden |

**Recommendation:** build model A first (smallest scope, no payment handling), keep the code behind an interface so model B only swaps where the token and the money come from.

## Proposed design

Everything fits the existing pipeline: the stamp is just another per-request asset (`assets.stamp`, see guide 10). No Typst CLI, no temp files, no caches.

1. **Backend `internetmarke.rs`** (new dependency: an HTTP client such as `reqwest` with rustls):
   - `GET /v1/postage/products`: filtered catalog (letter products only) with price, cached briefly in memory (public data).
   - `POST /v1/postage/stamps`: input `{ productCode, expectedPrice, shopOrderId, credentials }` (model A). Logs in, buys one stamp with `directCheckout=true`, downloads the PNG immediately (the link is short-lived), returns `{ png (base64), voucherId, price, walletBalance }`. Credentials and token live only for the request.
   - Config: `INTERNETMARKE_ENABLED` (default `false`), `INTERNETMARKE_CLIENT_ID`, `INTERNETMARKE_CLIENT_SECRET`, `INTERNETMARKE_BASE_URL` (sandbox vs. production). Document in guide 4.
   - Metrics (purchases, failures, latency) go into the dashboards and guide 13; rate limit via the existing token buckets; Anubis must still never front `/v1`.
2. **Templates:** optional `postage` input (base64 PNG). `document-common.typ` and `invoice.typ` place it with `place()` in the franking area of the DIN 5008 address field (inside the window of a window envelope, not the page corner), sized from the PNG resolution: width = pixels / 300 dpi × 25.4 mm. Must print at 100 %. `backend/src/invoice.rs`/`documents.rs` validate size (limit well below the 2 MB body cap) and PNG signature; the PDF stays PDF/A-3b.
3. **Frontend:** a "Postage" section in letter and invoice forms: product dropdown with price, a login dialog for the Portokasse credentials (kept in memory only), and an explicit "Buy stamp for X,XX €" button. The live preview shows the `validate=true` thumbnail or a placeholder and **never buys**. After purchase the stamp (PNG + voucher id) is kept in the draft/archive in the browser, so re-rendering or re-downloading does not buy again.
4. **Bulk:** `POST /v1/documents/bulk` would buy one stamp per document. Needs defined partial-failure behaviour (do not buy for documents that failed validation; report which stamps were bought). Out of scope for the first PR.

## Pitfalls to handle

- **A stamp is valid once.** Sending the same PDF twice wastes money or is misuse. Mark archived entries "stamp used" and warn on re-print.
- **No double purchase:** a unique `shopOrderId` per click, disable the button while pending, show the price and wallet balance before and after.
- **Failed render after a successful purchase:** return the stamp to the client anyway so nothing paid is lost.
- **Recipient address:** prefer `FRANKING_ZONE` without address. Passing the address (`ADDRESS_ZONE`) sends recipient data to Deutsche Post; if ever used, the privacy policy must say so.
- **Privacy policy / imprint:** mention Deutsche Post as an external service and (model A) the pass-through of login data.
- **Print quality:** test a physical print and scan it; the layout rules for the franking mark are binding, so check the final size and clear zone against the Deutsche Post specification (not verified offline).

## Suggested steps (one PR each)

1. Backend client, catalog endpoint, configuration, tests against a mock server, sandbox check.
2. Stamp purchase endpoint and template placement, with PDF rendering checks (with/without watermark, visual check).
3. Frontend UI, archive handling, DE/EN texts, privacy/landing updates.
4. Optional: reseller model with Stripe, bulk purchase.

## Open questions

- Is Deutsche Post onboarding (developer portal app, production credentials) done or planned?
- May a partner authenticate with end-customer Portokasse credentials (model A), or must the partner's own account be used (model B)?
- Which products are needed (standard/compact/large letter, postcard)?
