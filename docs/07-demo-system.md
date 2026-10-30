# 7. Demo System

Goal: let prospective customers try the configurator in the browser (form, live preview, PDF download) without giving them API keys and without exposing the production API.

## Key facts

- The frontend is a static site. It talks to the backend through `POST /generate-pdf`, which needs **no API key**.
- A key must never be embedded in the frontend: it would be visible to everyone.
- `POST /generate-pdf` accepts an arbitrary Typst template and has no per-user rate limit. The Typst engine only sees the request's own files and the vendored packages (no network, no host files), so the main risk is **resource abuse** (expensive layouts, many requests). Mitigate it as described below.
- Use a **separate backend instance** for the demo. Never enable `/generate-pdf` on the production API that customers use.

## Recommended setup

```
Browser ──HTTPS──> demo.example.com
                      │  reverse proxy (TLS, per-IP rate limit, body limit)
                      ├── /                      -> frontend (static files)
                      └── /generate-pdf, /health -> demo backend
```

Serving both under one domain makes the frontend same-origin, so no CORS is needed. Build the frontend with an **empty** API base URL (Verified: the bundle then calls `/generate-pdf` on the same origin):

```bash
docker build -t pdfcraft-frontend-demo --build-arg VITE_API_BASE_URL= frontend
```

If you prefer two domains (for example `demo.example.com` and `demo-api.example.com`):

```bash
docker build -t pdfcraft-frontend-demo \
  --build-arg VITE_API_BASE_URL=https://demo-api.example.com frontend
# on the demo backend:
CORS_ALLOWED_ORIGINS=https://demo.example.com
```

## Demo backend settings

```bash
ENABLE_GENERATE_PDF=true            # needed by the UI
# no API_KEYS and no DATABASE_URL  -> /v1 stays disabled (503)
MAX_CONCURRENT_COMPILES=2           # keep the demo cheap and bounded
CORS_ALLOWED_ORIGINS=https://demo.example.com   # only for the two-domain variant
```

Give the container a CPU and memory limit (for example 1 CPU, 512 MB) so abuse cannot affect anything else.

## Protect the demo at the proxy

The backend itself has no per-IP limit, so add one at the reverse proxy. Example for nginx (Untested):

```nginx
limit_req_zone $binary_remote_addr zone=pdf:10m rate=30r/m;

server {
  listen 443 ssl;
  server_name demo.example.com;
  client_max_body_size 2m;

  location = /generate-pdf {
    limit_req zone=pdf burst=10 nodelay;
    proxy_read_timeout 60s;
    proxy_pass http://demo-backend:3000;
  }
  location = /health { proxy_pass http://demo-backend:3000; }
  location / { proxy_pass http://demo-frontend:80; }
}
```

The preview refreshes about 600 ms after typing stops, so a normal user sends only a few requests per minute; 30 per minute with a burst of 10 is generous.

Further options: HTTP basic auth or a shared demo password at the proxy if only invited prospects should get in, a WAF or CDN in front, and an auto-shutdown schedule outside business hours.

## Demo data and privacy

- The configuration is stored in the visitor's browser only (`localStorage`); the server stores nothing.
- Tell prospects not to enter real customer data into the demo, because it is processed on your server.
- The pre-filled defaults (Muster GmbH, Kunde AG) are fictional and safe to show.

## Showing the API to prospects

Do not hand out a production key. Options:

1. Create a **demo customer key** with a small limit on a separate, non-production environment: `keys create --customer "Demo" --limit 20`, and revoke it after the demo (`keys revoke <id>`).
2. Show the `/v1` examples from your own terminal during a call (see the README "Production API").

## Deploy checklist

1. Build the frontend image with the right `VITE_API_BASE_URL`.
2. Run the backend image with `ENABLE_GENERATE_PDF=true`, resource limits, no keys.
3. Put TLS and the rate limit in front.
4. Open the site, change an item, check that the preview updates and the download works.
5. Confirm `/v1/invoices` answers `503` and nothing else is exposed.
