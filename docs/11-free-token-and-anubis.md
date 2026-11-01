# Free Token and Anubis

The demo at https://digitalrechnung.jetzt hands out **free tokens** (`pf_…`) to browsers. A free token is a rate limit (static, `FREE_RATE_LIMIT_PER_MINUTE`, default 20/min) with a lifetime (`FREE_TOKEN_TTL_SECONDS`, default 12 h). PDFs made with it carry the watermark **"Entwurf"**. Productive use needs a purchased token (see [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md)).

## How the endpoint is protected

[Anubis](https://anubis.techaro.lol/) is a proof-of-work reverse proxy. It sits in front of the **frontend** (`/`, `/app/`), not in front of the API:

```
browser ── / and /app/ ──> ingress ──> Anubis ──> frontend
browser ── /v1/*       ──> ingress ──────────────> backend
```

1. Opening `/app/` makes the browser solve a proof-of-work challenge (policy: `deploy/anubis/botPolicy.yaml`). Anubis then sets a signed JWT cookie (`techaro.lol-anubis-auth`, EdDSA, lifetime `COOKIE_EXPIRATION_TIME`, 12 h).
2. The frontend calls `POST /v1/free-token`. The request carries the cookie (same origin). The ingress routes it to the backend, **not** through Anubis.
3. The backend verifies the cookie with Anubis' **public key** (`ANUBIS_PUBLIC_KEY_HEX`): signature, `exp`, `nbf`. Without a valid cookie it answers `403 challenge_required`.
4. The backend remembers a hash of the cookie in Valkey (`SET NX EX`). Every solved challenge yields **one** free token; reuse answers `409 already_issued`.
5. When the token (and the pass) expire, the user solves a new challenge.

A script that calls `/v1/free-token` directly gets `403`. A script has to solve the proof-of-work for every single token. That is the same cost a browser pays, so mass creation is expensive, but not impossible. Raise `DIFFICULTY` or add per-IP limits at the edge if abuse shows up. The free token endpoint is disabled (`503`) until `ANUBIS_PUBLIC_KEY_HEX` is set.

Important: do **not** put Anubis in front of `/v1`. Its default behaviour lets plain HTTP clients through and it would only slow API clients down.

## Keys

```bash
docker run --rm ghcr.io/maltinapro/pdfcraft-backend:<tag> anubis-keygen
# or locally: cd backend && cargo run -- anubis-keygen
```

Prints `ED25519_PRIVATE_KEY_HEX` (Anubis, secret) and `ANUBIS_PUBLIC_KEY_HEX` (backend). Docker Compose ships a **local-only** key pair as default; never use it in production. Kubernetes: `anubis.privateKeyHex` and `anubis.publicKeyHex` in the Helm values, or one existing Secret (`anubis.existingSecret`) with the two keys:

```bash
kubectl create secret generic pdfcraft-anubis \
  --from-literal=ED25519_PRIVATE_KEY_HEX=<private> \
  --from-literal=ANUBIS_PUBLIC_KEY_HEX=<public>
```

Both Anubis and the backend read their value from this Secret. A single combined value is not used: Anubis only reads plain env vars and the backend must never see the private key.

## Settings

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `ANUBIS_PUBLIC_KEY_HEX` | backend | empty (free tokens off) | Public key to verify Anubis cookies |
| `ANUBIS_COOKIE_NAME` | backend | `techaro.lol-anubis-auth` | Cookie to read |
| `FREE_RATE_LIMIT_PER_MINUTE` | backend | `20` | Free token limit (the preview also uses tokens) |
| `FREE_TOKEN_TTL_SECONDS` | backend | `43200` | Free token lifetime; keep equal to Anubis' `COOKIE_EXPIRATION_TIME` |
| `ED25519_PRIVATE_KEY_HEX` | Anubis | none | Signing key |
| `DYNAMIC_COOKIE_SUFFIX` | Anubis | `true` | Must be `false`, otherwise the cookie name changes |
| `COOKIE_SECURE`, `COOKIE_PARTITIONED` | Anubis | `true` | Set both to `false` only for plain HTTP on localhost |

## Watermark

For free tokens the backend adds `settings.watermark = "Entwurf"` to the request. `frontend/src/template/invoice.typ` renders it as a grey diagonal background text on every page. Purchased tokens never get it.

## Test locally (Docker)

```bash
docker compose up --build
```

1. Open http://localhost:8080/app/ in a browser. Anubis shows its challenge ("Making sure you're not a bot!") and then the app.
2. In the browser console: `await (await fetch('/v1/free-token', {method: 'POST'})).json()` returns `{token, expiresAt, limitPerMinute}`. Repeating it returns `409 already_issued`.
3. `curl -X POST http://localhost:8080/v1/free-token` answers `403 challenge_required`.
4. Use the token with `POST /v1/invoices` (see [API Reference](09-api-reference.md)): the PDF shows the "Entwurf" watermark.

## Multiple Anubis pods (Kubernetes)

Anubis keeps open challenges in its store. The default in-memory store is per pod, so a challenge issued by one pod fails on another (`store: key not found: "challenge:..."`) and after restarts. The Helm chart therefore points Anubis at Valkey (`anubis.storeUrl`, default: the chart's Valkey). With `valkey.enabled=false` set `anubis.storeUrl` (for example `redis://:PASSWORD@host:6379/0`); the policy is rendered into a Secret, so a password in the URL is not exposed in a ConfigMap. `anubis.replicaCount > 1` without a store fails the render. The backend and frontend are stateless and can be scaled freely.
