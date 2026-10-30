# PDFCraft Documentation

Detailed guides for running, testing and deploying PDFCraft. The top-level [README](../README.md) is a short overview; these documents hold the details.

| # | Document | Read it when you want to… |
| --- | --- | --- |
| 1 | [Overview and Run Modes](01-overview-and-modes.md) | understand the components and which mode fits which purpose |
| 2 | [Local Development](02-local-development.md) | run frontend and backend from source and test them |
| 3 | [Docker (Local)](03-docker-local.md) | run everything in containers, with or without Postgres/Redis |
| 4 | [Configuration Reference](04-configuration.md) | look up every environment variable and build argument |
| 5 | [API Keys and Rate Limiting](05-api-keys-and-rate-limiting.md) | issue keys to customers and understand the limits |
| 6 | [Production Deployment](06-production.md) | run the customer-facing `/v1` API reliably and safely |
| 7 | [Demo System](07-demo-system.md) | show the configurator to prospective customers |
| 8 | [Kubernetes / Helm (Outlook)](08-kubernetes-helm-outlook.md) | plan a Helm chart (not implemented yet) |
| 9 | [API Reference](09-api-reference.md) | look up endpoints, request bodies and examples |
| 10 | [Architecture and Extending](10-architecture-and-extending.md) | understand the structure or add a field |

## Status legend

- **Verified**: tried in the development environment.
- **Untested**: written from the code and configuration, but not run end to end (for example `docker compose` itself, reverse-proxy snippets and anything Kubernetes-related). Treat these as a starting point.

## Quick start

```bash
# Terminal 1: backend (http://localhost:3000)
cd backend && cargo run

# Terminal 2: frontend (http://localhost:5173)
cd frontend && npm install && npm run dev
```

The live preview needs no API key.
