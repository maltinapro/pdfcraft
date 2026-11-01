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
PAID_TOKENS_ENABLED=true             # feature flag, see 12-paid-tokens-stripe.md
PAID_PLANS=starter=60,business=300,pro=1000
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

### Operations

- Purchased tokens are normally created by the Stripe webhook; manually with `pdfcraft-backend tokens create --plan ... --days ...` (see [Tokens](05-tokens-and-rate-limiting.md)).
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
