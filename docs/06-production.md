# 6. Production Deployment

Goal: customers call `POST /v1/invoices` and `/v1/invoices/bulk` with a purchased token. The configurator frontend is not part of this deployment (see [Demo System](07-demo-system.md) for that).

## Recommended architecture

```
Customer systems ──HTTPS──> Reverse proxy / load balancer (TLS, body limit, timeouts)
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
             backend instance 1        backend instance N      (stateless)
                    └────────────┬────────────┘
                                 ▼
                    Valkey (tokens + rate limit, persistent)
```

## Checklist

### Backend settings

```bash
VALKEY_URL=redis://...               # tokens and shared rate limit (persistent Valkey)
PAID_TOKENS_ENABLED=true             # feature flag, see 12-paid-tokens-mollie.md
PAID_PLANS=starter=30,business=100,pro=300
BULK_MAX_INVOICES=100
MAX_CONCURRENT_COMPILES=<CPU cores>
BIND_ADDR=0.0.0.0:3000
# CORS_ALLOWED_ORIGINS: server-to-server callers do not need CORS; set it only if browsers call the API
```

### Reverse proxy

- **TLS** termination with a valid certificate; redirect HTTP to HTTPS.
- **Body size** limit of about 2 MB (the backend enforces 2 MB too).
- **Timeouts**: a bulk request of 100 invoices takes roughly `100 × 0.1 s ÷ parallel compiles`, so seconds to tens of seconds; use read timeouts of at least 120 s for `/v1/invoices/bulk`.
- Optionally an extra per-IP limit as defense in depth.
- If the proxy buffers responses, allow ZIP responses of several MB.
- Expose only `/v1/*` (and `/health` internally).

### Infrastructure

- **Valkey**: a single instance with append-only persistence on a volume is enough (the Helm chart and Compose do this). It holds the purchased tokens, so back up the volume (or use a Valkey operator with replicas). Protect it with a password (`redis://:password@host:6379`) and a private network.
- **Backend sizing**: a compile is CPU-bound and single-threaded (about 50–200 ms). Plan roughly one CPU core per 5–10 invoices per second. Memory is modest (hundreds of MB). Scale horizontally by adding instances.
- **Health checks**: `GET /health` on port 3000 for liveness and readiness. The backend does a warm-up compile at start, so allow a few seconds after start.
- **Secrets**: provide `VALKEY_URL` through your secret store, not in images or the repository.
- **Packages**: the image bundles `vendor/typst-packages`; no outbound network is required at runtime.

### Internetmarke (Deutsche Post stamps, optional)

Off by default. Before enabling it in production:

1. **Onboarding with Deutsche Post:** production credentials (client id/secret of the DHL developer portal app) come with the partner onboarding. Clarify with Deutsche Post that the app may log in with *end-customer* Portokasse credentials; if not, a reseller model is needed (see [Internetmarke](14-internetmarke-integration.md), open points).
2. **Configuration:** `INTERNETMARKE_ENABLED=true`, `INTERNETMARKE_CLIENT_ID`, `INTERNETMARKE_CLIENT_SECRET` from your secret store (Helm: `backend.internetmarkeSecret` plus `backend.env.INTERNETMARKE_ENABLED: "true"`). Leave `INTERNETMARKE_SHIPPING_URL`/`INTERNETMARKE_PRODUCTS_URL` empty for production (sandbox URLs only for tests).
3. **Network:** the backend needs outbound HTTPS to `api-eu.dhl.com` (and the stamp download host the API returns). With a NetworkPolicy or egress filter, allow it; the stamp download link must be https.
4. **Privacy:** the backend stores nothing of the purchase (login, token and PNG exist only in the request; Valkey keeps a hashed 15 minute marker). Do not log request or response bodies at the proxy for `/v1/postage/*`, they contain the Portokasse password and the stamp. Update and verify the privacy policy (`datenschutz.html` already has an "Internetmarke" section).
5. **Rate limits:** a purchase costs 5 rate-limit tokens (bulk: `4 + n`, max 25 stamps). A free token (20/min) can buy at most 16 stamps in bulk.
6. **Monitoring:** metric `pdfcraft_postage_stamps_total{result}` and the dashboard panel "Internetmarke purchases by result" ([Observability](13-observability.md)). Watch `postage_download_failed` (paid but not downloaded; the response names the shop order id, the message points the user to the order in the Portokasse; the client can fetch the stamp again via `POST /v1/postage/stamps/recover`, which is unverified against the live service) and `postage_upstream_error`.
7. **Optional test stamps for free tokens:** set `INTERNETMARKE_SANDBOX_SHIPPING_URL` (and the shared test login) so draft/watermark PDFs never spend real postage; see [Internetmarke](14-internetmarke-integration.md).
8. **Acceptance test before go-live:** run the flow once against the sandbox, then buy one real stamp, print the PDF at 100 % into a window envelope and check size, position and that the code scans (the placement was verified visually only).

### Operations

- Purchased tokens are normally created by the Mollie webhook; manually with `pdfcraft-backend tokens create --plan ... --days ...` (see [Tokens](05-tokens-and-rate-limiting.md)).
- Logs go to stdout: compile timings (`typst layout`, `pdf export`) and warnings (for example Valkey unreachable). Request logging per customer is not implemented; the reverse proxy access log fills that gap.
- Rolling updates are safe: instances are stateless.
- No PDFs or invoice data are persisted by the backend. If you log request bodies at the proxy, you are storing customer data; avoid that.

### Hardening ideas (not done yet)

- Run the container as a non-root user with a read-only root file system.
- Network policies or security groups so only the proxy reaches the backend, and only the backend reaches Valkey.
- Usage statistics and an admin API.
- Separate rate-limit classes for single and bulk endpoints.

## Minimal single-host example (Untested)

A Docker host with a reverse proxy such as Caddy or nginx:

```bash
export PAID_TOKENS_ENABLED=true

docker compose up -d --build valkey backend     # without the frontend service
docker compose exec backend /app/pdfcraft-backend tokens create --plan starter --days 30
```

Put the proxy in front of port 3000 and publish only 443. For real production use, prefer an orchestrator with a persistent Valkey (see [Kubernetes / Helm](08-kubernetes-helm-outlook.md)).

## Verifying a deployment

```bash
curl -s https://api.example.com/health
curl -i -X POST https://api.example.com/v1/invoices                         # expect 401
curl -X POST https://api.example.com/v1/invoices -H "Authorization: Bearer $KEY" \
     -H 'content-type: application/json' --data @pdfcraft-config.json -o test.pdf
```

Validate one produced PDF with Mustang (see [Local Development](02-local-development.md#6-validate-e-invoice-pdfs-optional)).
