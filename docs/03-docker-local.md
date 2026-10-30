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

Only `/generate-pdf` works (no keys configured), which is all the UI needs.

### With a static API key

```bash
API_KEYS=secret docker compose up --build
curl -X POST http://localhost:3000/v1/invoices \
  -H 'Authorization: Bearer secret' -H 'content-type: application/json' \
  --data @pdfcraft-config.json -o invoice.pdf
```

### Without the arbitrary-template endpoint

```bash
ENABLE_GENERATE_PDF=false API_KEYS=secret docker compose up --build backend
```

The UI preview stops working in this mode (it needs `/generate-pdf`); only `/v1` is served.

## Compose: shared mode with Postgres and Redis (Untested)

The `shared` profile adds `postgres` and `redis`. Because the backend exits if `DATABASE_URL` is set but Postgres is not ready, start the data services first:

```bash
export DATABASE_URL=postgres://postgres:pdfcraft@postgres:5432/pdfcraft
export REDIS_URL=redis://redis:6379

docker compose --profile shared up -d postgres redis

# create a customer key (printed once)
docker compose --profile shared run --rm backend \
  /app/pdfcraft-backend keys create --customer "ACME" --limit 300

# start the rest
docker compose --profile shared up --build -d
```

Manage keys later the same way (`keys list`, `keys revoke <id>`, `keys activate <id>`).

The default Postgres password is `pdfcraft`; change it with `POSTGRES_PASSWORD` (and in `DATABASE_URL`). Data lives in the `pgdata` volume. Do not use the defaults outside local testing.

To test the shared limit with two backend instances, scale the service. Two containers cannot bind the same host port, so remove the fixed `3000:3000` mapping or put a load balancer in front first:

```bash
docker compose --profile shared up -d --scale backend=2
```

## Quick container smoke test (Verified)

```bash
docker build -f backend/Dockerfile -t pdfcraft-backend .
docker run --rm -d --name pcbe -e API_KEYS=dockerkey -p 3002:3000 pdfcraft-backend
curl -s -X POST localhost:3002/v1/invoices \
  -H 'content-type: application/json' -H 'Authorization: Bearer dockerkey' \
  --data @pdfcraft-config.json -o out.pdf && head -c 5 out.pdf   # %PDF-
docker stop pcbe
```

## Notes

- The current Dockerfile runs the binary as root; for production consider adding a non-root user.
- The backend image needs no network access at runtime.
- Healthcheck target: `GET /health` on port 3000.
