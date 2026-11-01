# 3. Docker (Local)

Files: `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `.dockerignore`.

## Images

| Image | Build | Contents |
| --- | --- | --- |
| Backend | `docker build -f backend/Dockerfile -t pdfcraft-backend .` | Release binary + `vendor/typst-packages`; `TYPST_PACKAGE_PATH=/app/typst-packages`; port 3000 |
| Frontend | `docker build -t pdfcraft-frontend frontend` | Static build served by nginx; port 80 |

The backend build context is the **repository root**, because the binary embeds `frontend/src/template/invoice.typ`.

The frontend image bakes the backend URL in at build time:

```bash
docker build -t pdfcraft-frontend --build-arg VITE_API_BASE_URL=http://localhost:3000 frontend
```

The URL is the one the **browser** uses, not an internal container name.

## Compose: basic stack (images Verified; `docker compose` itself Untested)

```bash
docker compose up --build
```

- Frontend: `http://localhost:8080` (landing page), app at `http://localhost:8080/app/`
- Backend: `http://localhost:3000`

Compose also starts **Valkey** (`valkey` service, volume `valkeydata`, append-only persistence), where tokens and rate limits live.

### Try `/v1` with a token

```bash
docker compose up --build -d
docker compose exec backend /app/pdfcraft-backend tokens create-free     # prints pf_... once
curl -X POST http://localhost:3000/v1/invoices \
  -H 'Authorization: Bearer <token>' -H 'content-type: application/json' \
  --data @pdfcraft-config.json -o invoice.pdf
```

Purchased tokens: `PAID_TOKENS_ENABLED=true docker compose up -d`, then `docker compose exec backend /app/pdfcraft-backend tokens create --plan starter --days 30`. Without the flag they are rejected.

Tokens survive `docker compose down` (the volume stays); `docker compose down -v` deletes them.

### Without the arbitrary-template endpoint

```bash
ENABLE_GENERATE_PDF=false docker compose up --build backend
```

The UI preview stops working in this mode (it needs `/generate-pdf`); only `/v1` is served.

## Quick container smoke test (Verified)

```bash
docker build -f backend/Dockerfile -t pdfcraft-backend .
docker run --rm -d --name pcvk valkey/valkey:8-alpine
docker run --rm -d --name pcbe --link pcvk -e VALKEY_URL=redis://pcvk:6379 -p 3002:3000 pdfcraft-backend
docker exec pcbe /app/pdfcraft-backend tokens create-free   # prints pf_...
curl -s -X POST localhost:3002/v1/invoices \
  -H 'content-type: application/json' -H 'Authorization: Bearer dockerkey' \
  --data @pdfcraft-config.json -o out.pdf && head -c 5 out.pdf   # %PDF-
docker stop pcbe pcvk
```

## Notes

- The current Dockerfile runs the binary as root; for production consider adding a non-root user.
- The backend image needs no network access at runtime.
- Healthcheck target: `GET /health` on port 3000.
