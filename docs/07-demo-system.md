# 7. Demo System

Goal: let prospective customers try the configurator in the browser (form, live preview, PDF download) without giving them purchased tokens and without exposing the production API.

## Key facts

- The frontend is a static site behind **Anubis**. It talks to the backend through `POST /v1/invoices` with a **free token** that it gets from `POST /v1/free-token` after the browser solved the challenge ([Free Token and Anubis](11-free-token-and-anubis.md)). PDFs carry the watermark "Entwurf".
- A purchased token must never be embedded in the frontend: it would be visible to everyone.
- The main risk is **resource abuse** (expensive layouts, many requests). The free token has a static rate limit and a short lifetime; add an edge limit as described below.
- Use a **separate backend instance** (and Valkey) for the demo, not the one customers use.

## Landing page

The frontend serves a German landing page at `/` (`frontend/index.html`, no JavaScript) with a link to the app at `/app/` (`frontend/app/index.html`). It also contains `impressum.html` and `datenschutz.html`. Fill in the placeholders in these two files before publishing: in Germany a publicly reachable service needs an Impressum (§ 5 DDG) with name, a summonable postal address and an e-mail address. A c/o or virtual-office address is possible only if mail is really received there. The privacy policy describes the Anubis cookie, the free token in `localStorage` and the Valkey data (token hash, limit, expiry, hash of the Anubis pass, rate-limit counters); update it together with any change to what is stored, and before enabling purchased tokens (Stripe) add the payment processing. The landing page names maltina.pro (UG in formation, hello@maltina.pro) and Vorneweg (infrastructure, operation, resources). This is not legal advice.

### Search engines (SEO)

`frontend/index.html` carries title, description, canonical URL, Open Graph tags and JSON-LD (`SoftwareApplication`); the legal pages and `/app/` are `noindex`. `frontend/public/robots.txt` and `sitemap.xml` are copied to the site root; the Anubis policy (`deploy/anubis/botPolicy.yaml`, Helm `files/botPolicy.yaml`) lets `/`, `robots.txt` and `sitemap.xml` through without a challenge, so crawlers can index the landing page. Adjust the hostname in these files for other domains. After deployment: add the domain to Google Search Console (DNS TXT) and Bing Webmaster Tools and submit `https://<host>/sitemap.xml`. A separate GitHub Pages site is not needed (duplicate content).

## Kubernetes (k3s) deployment

A minimal Helm chart and a GitHub Actions workflow that publishes the container images are included: see [`deploy/helm/pdfcraft/README.md`](../deploy/helm/pdfcraft/README.md).

## Where to rate-limit: application vs. edge

| Layer | Responsibility |
| --- | --- |
| Edge (Cloudflare, WAF, CDN) | Per-IP limit for `/v1/free-token` and `/v1/invoices`, bot protection, DDoS, TLS. Abusive traffic never reaches the cluster and costs no CPU |
| Ingress (Traefik / nginx) | Optional second per-IP limit as a safety net (see below) |
| Application | Per-token limit (token bucket, bulk costs N), compile semaphore, input validation |

Why not per-IP in the backend: behind proxies the backend only sees the proxy address, and trusting `X-Forwarded-For` safely needs extra configuration. The edge does this reliably. The per-token limit stays in the application because only it knows the key, the customer quota and the cost of a request.

### Cloudflare (recommended for the demo)

Put the demo domain behind Cloudflare (proxied DNS record) and add a rate-limiting rule (Security → WAF → Rate limiting rules). Example (Untested):

- If: URI Path starts with `/v1/` and Method equals `POST`
- Characteristics: IP
- Rate: 30 requests per minute (the preview sends a few per minute while typing)
- Action: Block for 1 minute

Also enable Bot Fight Mode. Set SSL/TLS mode to "Full (strict)" so Cloudflare talks HTTPS to the origin (the cert-manager certificate on the cluster works for this). Because the origin sees Cloudflare's addresses, use the `CF-Connecting-IP` header if you ever need the client IP.

### Frontend on a CDN

The frontend is static and fits a CDN well (Cloudflare Pages, Netlify, S3 + CDN). Two ways:

1. **Same origin through Cloudflare (preferred):** one hostname; route `/` to the CDN origin (Anubis in front of it) and `/v1` to the cluster (Cloudflare Workers routes or Load Balancing path rules). Build the frontend with an empty `VITE_API_BASE_URL`; no CORS needed and the images stay environment-independent.
2. **Separate API hostname:** build the frontend with `VITE_API_BASE_URL=https://api.example.com` and set `CORS_ALLOWED_ORIGINS=https://demo.example.com` on the backend. Needs a new frontend build per environment, and the rate-limit rule applies to the API hostname.

In both cases the landing page, `/app/`, `impressum.html` and `datenschutz.html` are plain static files, so they work on any static host.

## Recommended setup

```
Browser ──HTTPS──> demo.example.com
                      │  reverse proxy (TLS, per-IP rate limit, body limit)
                      ├── /          -> Anubis -> frontend (static files)
                      └── /v1, /health -> demo backend (not behind Anubis)
```

Serving both under one domain makes the frontend same-origin, so no CORS is needed. Build the frontend with an **empty** API base URL (Verified: the bundle then calls `/v1` on the same origin):

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
VALKEY_URL=redis://...              # tokens and rate limits
ANUBIS_PUBLIC_KEY_HEX=...           # enables free tokens
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

  location /v1/ {
    limit_req zone=pdf burst=10 nodelay;
    proxy_read_timeout 60s;
    proxy_pass http://demo-backend:3000;
  }
  location = /health { proxy_pass http://demo-backend:3000; }
  location / {
    proxy_pass http://anubis:8923;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
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

1. Create a **demo token**: `tokens create-free` (static free limit, expires on its own) or a purchased one with `tokens create --plan starter --days 1`, and revoke it after the demo (`tokens revoke <id>`).
2. Show the `/v1` examples from your own terminal during a call (see the README "Production API").

## Deploy checklist

1. Build the frontend image with the right `VITE_API_BASE_URL`.
2. Run the backend image with `VALKEY_URL`, `ANUBIS_PUBLIC_KEY_HEX`, resource limits, and Anubis with the matching private key.
3. Put TLS and the rate limit in front.
4. Open the site, change an item, check that the preview updates and the download works.
5. Confirm `POST /v1/free-token` without the Anubis cookie answers `403` and `/v1/invoices` without a token answers `401`.
