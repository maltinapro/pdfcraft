# 2. Local Development

## Prerequisites

- Rust (stable) with `cargo`. The first build compiles Typst and takes several minutes; later builds are fast.
- Node.js 20+ with `npm`.
- Optional: `curl`, `jq` for API tests; Docker for Valkey; Java and the [Mustang CLI](https://www.mustangproject.org/) to validate e-invoice PDFs.

Nix users: `backend/shell.nix` provides a shell.

## 1. Start the backend

```bash
cd backend
cargo run
```

It listens on `http://0.0.0.0:3000` (change with `BIND_ADDR`). Check it:

```bash
curl http://localhost:3000/health      # {"status":"ok"}
```

The dev profile is optimized (`opt-level`) on purpose: Typst is very slow unoptimized. A warm-up compile runs at start-up so the first request is fast (about 50–200 ms afterwards).

Vendored Typst packages are read from `backend/vendor/typst-packages`; override with `TYPST_PACKAGE_PATH`.

## 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173/app/` (`/` is the German landing page, see [Demo System](07-demo-system.md)). The preview refreshes about 600 ms after you stop typing. The configuration is saved in the browser (`localStorage`, key `pdfcraft.config`).

The frontend talks to `http://localhost:3000` by default. To use another backend:

```bash
VITE_API_BASE_URL=http://localhost:4000 npm run dev
```

`VITE_API_BASE_URL` is read at build time. An empty value means same origin (`/v1/...`).

The UI calls `POST /v1/invoices` with a token. In the full stack it gets a free token from `/v1/free-token` after the Anubis challenge ([Free Token and Anubis](11-free-token-and-anubis.md)). Without Anubis (`npm run dev`) create a free token and pass it at start:

```bash
cd backend && cargo run -- tokens create-free     # prints pf_... (needs VALKEY_URL, see section 5)
cd frontend && VITE_API_TOKEN=pf_... npm run dev
```

## 3. Test checklist

```bash
cd backend  && cargo check
cd frontend && npm run build
```

Manual UI checks:

1. Edit sender, recipient and items; the preview updates.
2. Switch the e-invoice profile to XRechnung; the sidebar lists missing data (contact name, phone, buyer reference).
3. **Exportieren**, reload, **Importieren**; settings are restored.
4. **PDF herunterladen** produces a PDF with an embedded `factur-x.xml` (EN 16931) or `xrechnung.xml`.

## 4. Test the `/v1` API with tokens (needs Valkey)

```bash
docker run -d --name pdfcraft-valkey -p 6379:6379 valkey/valkey:8-alpine valkey-server --appendonly yes
export VALKEY_URL=redis://localhost:6379

cd backend
cargo run -- tokens create-free                 # prints pf_... once
PAID_TOKENS_ENABLED=true cargo run              # start the server (paid tokens on)
```

In a second terminal:

```bash
cd backend
cargo run -- tokens create --plan starter --days 30   # prints pk_... once
cargo run -- tokens list
```

```bash
# In the UI: Exportieren -> pdfcraft-config.json
curl -X POST http://localhost:3000/v1/invoices \
  -H 'Authorization: Bearer <token>' -H 'content-type: application/json' \
  --data @pdfcraft-config.json -o invoice.pdf

# Without or with a wrong token -> 401
curl -i -X POST http://localhost:3000/v1/invoices --data @pdfcraft-config.json
```

Bulk:

```bash
cat > bulk.json <<'EOF'
{
  "settings": { "sender": { "name": "Muster GmbH", "address": "Musterstraße 1", "city": "12345 Musterstadt" } },
  "invoices": [
    { "number": "2026-001", "date": "2026-10-30",
      "recipient": { "name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt" },
      "items": [ { "description": "Beratung", "quantity": 2, "unit": "h", "price": 95, "taxRate": 19 } ] },
    { "number": "2026-002", "date": "2026-10-30",
      "recipient": { "name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt" },
      "items": [ { "description": "Hosting", "quantity": 1, "unit": "mo", "price": 15, "taxRate": 19 } ] }
  ]
}
EOF
curl -X POST http://localhost:3000/v1/invoices/bulk \
  -H 'Authorization: Bearer secret' -H 'content-type: application/json' \
  --data @bulk.json -o invoices.zip
unzip -l invoices.zip
```

Useful error cases: an invalid unit or date returns `400 validation_error` listing every problem at once; more than `BULK_MAX_INVOICES` returns `400`.

Test the rate limit with a tiny free limit:

```bash
FREE_RATE_LIMIT_PER_MINUTE=3 cargo run
# the 4th invoice within a minute with a free token -> 429 with a Retry-After header
```

## 5. Test tokens across instances, expiry and revocation

Start two instances in separate terminals (same `VALKEY_URL`):

```bash
BIND_ADDR=0.0.0.0:3000 cargo run
BIND_ADDR=0.0.0.0:3001 cargo run
```

Alternate requests between ports 3000 and 3001 with the same token: the limit is shared. Then:

```bash
cargo run -- tokens revoke <id>                 # the token gets 401 immediately
FREE_TOKEN_TTL_SECONDS=60 cargo run -- tokens create-free   # expires (401) after 60 s
docker stop pdfcraft-valkey                     # /v1 answers 503 store_unavailable
```

Cleanup: `docker rm -f pdfcraft-valkey`.

## 6. Validate e-invoice PDFs (optional)

```bash
java -jar Mustang-CLI-2.26.0.jar --action validate --source invoice.pdf
```

Expected: `Parsed PDF:valid XML:valid`, PDF/A-3b compliant. For the EN 16931 profile, XRechnung-only rules (BR-DE-*) appear as notices; with the XRechnung profile and contact, phone and buyer reference filled in they disappear.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Preview shows a connection error | Backend not running or wrong `VITE_API_BASE_URL` |
| Browser CORS error | `CORS_ALLOWED_ORIGINS` is set and does not contain the frontend origin |
| `/v1` returns 503 | `VALKEY_URL` is not set or Valkey is not reachable |
| `/v1` returns 401 | Wrong or expired token; paid tokens need `PAID_TOKENS_ENABLED=true` |
| `cargo run -- tokens ...` says `VALKEY_URL must be set` | Export `VALKEY_URL` first |
| `typst_compile_error` mentioning `@preview/...` | Vendored packages not found; check `TYPST_PACKAGE_PATH` |
| First `cargo run` takes minutes | Normal (compiling Typst); later runs are fast |
