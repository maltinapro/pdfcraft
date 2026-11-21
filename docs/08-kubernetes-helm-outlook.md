# 8. Kubernetes / Helm

One chart, [`deploy/helm/pdfcraft`](../deploy/helm/pdfcraft/README.md), deploys both systems; the values decide which one:

| Values file | Deploys |
| --- | --- |
| `values-demo.yaml` | Demo system: frontend, Anubis, free tokens, backend, Valkey, Ingress (see [Demo System](07-demo-system.md)) |
| `values-production.yaml` | **Production API**: the `/v1` backend only (no frontend, Anubis or free tokens), HPA, PodDisruptionBudget, NetworkPolicy, ServiceMonitor, existing Secrets, external Valkey |

The chart is published as an OCI chart on every GitHub release: `oci://ghcr.io/maltinapro/charts/pdfcraft`, chart `version` = `appVersion` = the release version (for example `0.1.0`; use the release you want in all commands below); the images with the same tag are the default. See "Releasing" in the chart README.

## Production install

1. Create the Secrets (the chart never creates or stores token material in production):

   ```bash
   kubectl -n pdfcraft create secret generic pdfcraft-valkey \
     --from-literal=VALKEY_URL='rediss://:PASSWORD@valkey.example:6379'
   kubectl -n pdfcraft create secret generic pdfcraft-service-tokens \
     --from-file=service-tokens=./service-tokens.txt
   ```

   `service-tokens.txt` holds one `<id>:<sha256 hex>:<plan or limit>` line per tenant/application, created with `pdfcraft-backend tokens create-service` (see [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md#static-service-tokens)). Only hashes are stored. Service tokens work without Valkey; with `backend.valkeySecret` the rate limit is shared by all replicas (without it, each pod has its own bucket).

2. Get the values file and install:

   ```bash
   helm pull oci://ghcr.io/maltinapro/charts/pdfcraft --version 0.1.0 --untar
   helm upgrade --install pdfcraft oci://ghcr.io/maltinapro/charts/pdfcraft \
     --version 0.1.0 -n pdfcraft --create-namespace -f pdfcraft/values-production.yaml
   ```

A caller in the cluster uses `http://pdfcraft-backend.pdfcraft.svc:3000/v1/...`. Enable the Ingress (`ingress.enabled=true`, `ingress.host`) only to reach the API from outside; it routes `/v1` only (`/health` and the metrics port are never exposed).

## What the production values switch on

| Resource | Values | Notes |
| --- | --- | --- |
| API only | `frontend.enabled=false`, `anubis.enabled=false` | The chart refuses `anubis.enabled=true` without the frontend. |
| Valkey | `valkey.enabled=false` + `backend.valkeySecret` (key `VALKEY_URL`) | External or operator-managed Valkey; `valkey.enabled=true` runs the chart's single persistent instance instead. |
| Tokens | `backend.serviceTokensSecret` (key `service-tokens`) | The chart fails when neither Valkey nor service tokens are configured. |
| `HorizontalPodAutoscaler` | `backend.autoscaling.*` | CPU based (compilation is CPU bound; relative to `resources.requests.cpu`); `replicaCount` is ignored while enabled. |
| `PodDisruptionBudget` | `backend.podDisruptionBudget.*` | `minAvailable: 1`; needs at least 2 replicas to allow node drains. |
| `NetworkPolicy` | `networkPolicy.*` | Backend ingress only on 3000 (from `ingressFrom`) and on the metrics port (from `metricsFrom`, only with monitoring); egress only to DNS, the chart's Valkey and `egress.extra` (add your external Valkey there). With `valkey.enabled`, a second policy lets only the backend and Anubis reach Valkey. Needs a CNI that enforces policies. |
| `ServiceMonitor` | `metrics.serviceMonitor.*` | Scrapes a dedicated ClusterIP Service `<release>-backend-metrics` that carries only the metrics port. `metrics.podMonitor` is the alternative without that Service; enable only one. |
| Hardening | `podSecurityContext`, `securityContext`, `automountServiceAccountToken: false`, `backend.spreadAcrossNodes` | Non-root, read-only root file system, no capabilities, `RuntimeDefault` seccomp (already the chart default). |

Probes and resources: `GET /health` for readiness (5 s) and liveness (15 s); the backend does a warm-up compile at start. Set `MAX_CONCURRENT_COMPILES` close to the CPU limit (`backend.resources.limits.cpu`); see sizing in [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md) and [Production](06-production.md).

## Using the chart from another chart

FediFinance (or any other application) can list PDFCraft as a dependency:

```yaml
dependencies:
  - name: pdfcraft
    version: 0.1.0
    repository: oci://ghcr.io/maltinapro/charts
```

and set the values below the `pdfcraft:` key (start from `values-production.yaml`). Set `pdfcraft.fullnameOverride` (for example `fedi-pdfcraft`) so the resource names (`<name>-backend`, ...) cannot clash with the parent chart's resources. One release per tenant works the same way: install the chart once per namespace with its own `serviceTokensSecret`, or share one install and give each tenant its own service token.

## Open design points

1. **Token management.** `tokens create` / `create-service` are commands of the backend binary: run them locally or with `kubectl exec` into a pod. Tokens are shown only once; purchased tokens are normally created by the Mollie webhook.
2. **Rate limiting at the ingress.** The backend limits per token; add ingress limits (per IP) for the demo and as a safety net in production.
3. **Secrets.** Use an external secrets operator or sealed secrets to create the Secrets above rather than plaintext values files.
4. **Not in the chart:** image pull secrets for private registries, a Valkey HA setup (use an operator), a NetworkPolicy for the demo's frontend/Anubis pods, and a load test of `/v1/invoices/bulk` to tune the CPU limits for your hardware.
