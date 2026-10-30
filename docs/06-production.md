# 6. Production Deployment

Goal: customers call `POST /v1/invoices` and `/v1/invoices/bulk` with their own API key. The configurator frontend is not part of this deployment (see [Demo System](07-demo-system.md) for that).

## Recommended architecture

```
Customer systems ──HTTPS──> Reverse proxy / load balancer (TLS, body limit, timeouts)
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
             backend instance 1        backend instance N      (stateless)
                    └────────────┬────────────┘
                       ┌─────────┴─────────┐
                       ▼                   ▼
                  Postgres (keys)     Redis (rate limit)
```

## Checklist

### Backend settings

```bash
ENABLE_GENERATE_PDF=false            # no arbitrary templates for external callers
DATABASE_URL=postgres://...          # keys in Postgres, not API_KEYS
REDIS_URL=redis://...                # shared rate limit across instances
RATE_LIMIT_PER_MINUTE=120            # default; set per customer with --limit
BULK_MAX_INVOICES=100
MAX_CONCURRENT_COMPILES=<CPU cores>
BIND_ADDR=0.0.0.0:3000
# CORS_ALLOWED_ORIGINS: server-to-server callers do not need CORS; set it only if browsers call the API
```

Do not set `API_KEYS` unless you need a break-glass key.

### Reverse proxy

- **TLS** termination with a valid certificate; redirect HTTP to HTTPS.
- **Body size** limit of about 2 MB (the backend enforces 2 MB too).
- **Timeouts**: a bulk request of 100 invoices takes roughly `100 × 0.1 s ÷ parallel compiles`, so seconds to tens of seconds; use read timeouts of at least 120 s for `/v1/invoices/bulk`.
- Optionally an extra per-IP limit as defense in depth.
- If the proxy buffers responses, allow ZIP responses of several MB.
- Expose only `/v1/*` (and `/health` internally). Block `/generate-pdf` at the proxy as well, even if you disabled it.

### Infrastructure

- **Postgres**: managed service preferred; daily backups (the `api_keys` table is small but critical). Use TLS in the connection string if the provider requires it (`?sslmode=require`).
- **Redis**: a small instance is enough. Persistence is not needed; losing it only resets the buckets. Protect it with a password and a private network.
- **Backend sizing**: a compile is CPU-bound and single-threaded (about 50–200 ms). Plan roughly one CPU core per 5–10 invoices per second. Memory is modest (hundreds of MB). Scale horizontally by adding instances.
- **Health checks**: `GET /health` on port 3000 for liveness and readiness. The backend does a warm-up compile at start, so allow a few seconds after start.
- **Secrets**: provide `DATABASE_URL` and `REDIS_URL` through your secret store, not in images or the repository.
- **Packages**: the image bundles `vendor/typst-packages`; no outbound network is required at runtime.

### Operations

- Create customer keys from a trusted machine or a one-off job: `pdfcraft-backend keys create --customer ... --limit ...` (see [API Keys](05-api-keys-and-rate-limiting.md)).
- Logs go to stdout: compile timings (`typst layout`, `pdf export`) and warnings (for example Redis unreachable). Request logging per customer is not implemented; the reverse proxy access log fills that gap.
- Rolling updates are safe: instances are stateless and the schema is created idempotently.
- No PDFs or invoice data are persisted by the backend. If you log request bodies at the proxy, you are storing customer data; avoid that.

### Hardening ideas (not done yet)

- Run the container as a non-root user with a read-only root file system.
- Network policies or security groups so only the proxy reaches the backend, and only the backend reaches Postgres and Redis.
- Key expiry, usage statistics and an admin API.
- Separate rate-limit classes for single and bulk endpoints.

## Minimal single-host example (Untested)

A Docker host with a reverse proxy such as Caddy or nginx:

```bash
export POSTGRES_PASSWORD=<strong-password>
export DATABASE_URL=postgres://postgres:<strong-password>@postgres:5432/pdfcraft
export REDIS_URL=redis://redis:6379
export ENABLE_GENERATE_PDF=false

docker compose --profile shared up -d postgres redis
docker compose --profile shared run --rm backend /app/pdfcraft-backend keys create --customer "ACME" --limit 300
docker compose --profile shared up -d --build backend     # without the frontend service
```

Put the proxy in front of port 3000 and publish only 443. For real production use, prefer managed Postgres/Redis and an orchestrator (see [Kubernetes / Helm](08-kubernetes-helm-outlook.md)).

## Verifying a deployment

```bash
curl -s https://api.example.com/health
curl -i -X POST https://api.example.com/v1/invoices                         # expect 401
curl -i -X POST https://api.example.com/generate-pdf -d '{}'                 # expect 404
curl -X POST https://api.example.com/v1/invoices -H "Authorization: Bearer $KEY" \
     -H 'content-type: application/json' --data @pdfcraft-config.json -o test.pdf
```

Validate one produced PDF with Mustang (see [Local Development](02-local-development.md#7-validate-e-invoice-pdfs-optional)).
