# 8. Kubernetes / Helm (Outlook)

> **Status:** a first, minimal chart for the **demo system** exists in [`deploy/helm/pdfcraft`](../deploy/helm/pdfcraft/README.md) (see [Demo System](07-demo-system.md)). Everything below describes the fuller **production** chart, which is **planned, not implemented**.

## Goals

- One chart that can deploy both the **production API** and the **demo system** (different values).
- Stateless backend, horizontally scalable, rolling updates without downtime.
- Valkey: the chart ships a single persistent StatefulSet; for HA use an external Valkey or a Valkey operator.

## Proposed chart layout

```
deploy/helm/pdfcraft/
├── Chart.yaml
├── values.yaml
├── values-production.yaml        # example: /v1 only
├── values-demo.yaml              # example: frontend + Anubis + free tokens
└── templates/
    ├── backend-deployment.yaml
    ├── backend-service.yaml
    ├── backend-hpa.yaml
    ├── backend-pdb.yaml
    ├── frontend-deployment.yaml   # only if frontend.enabled
    ├── frontend-service.yaml
    ├── ingress.yaml
    ├── secret.yaml                # optional; prefer existingSecret
    ├── networkpolicy.yaml
    └── job-create-key.yaml        # optional helper, see open design points
```

## Resources

| Kind | Purpose |
| --- | --- |
| `Deployment` (backend) | Image `pdfcraft-backend`, port 3000, 2+ replicas for production |
| `Service` (backend) | ClusterIP on 3000 |
| `Deployment` + `Service` (frontend) | nginx image, only for the demo |
| `Ingress` | TLS (cert-manager); routes `/v1` (production) or `/v1` and `/` via Anubis (demo) |
| `HorizontalPodAutoscaler` | Scale on CPU (compilation is CPU-bound) |
| `PodDisruptionBudget` | `minAvailable: 1` during node maintenance |
| `NetworkPolicy` | Only ingress → backend; only backend → Valkey |
| `Secret` | `VALKEY_URL` (or reference an `existingSecret` / external secrets operator) |

## Probes and resources

```yaml
readinessProbe:
  httpGet: { path: /health, port: 3000 }
  initialDelaySeconds: 5      # warm-up compile at start
livenessProbe:
  httpGet: { path: /health, port: 3000 }
  initialDelaySeconds: 15
resources:
  requests: { cpu: 500m, memory: 256Mi }
  limits:   { cpu: "2",  memory: 768Mi }
```

Set `MAX_CONCURRENT_COMPILES` close to the CPU limit.

## Example values

Production (`values-production.yaml`):

```yaml
backend:
  replicaCount: 2
  env:
    RATE_LIMIT_PER_MINUTE: "120"
    BULK_MAX_INVOICES: "100"
    MAX_CONCURRENT_COMPILES: "2"
  existingSecret: pdfcraft-secrets     # keys: VALKEY_URL
frontend:
  enabled: false
ingress:
  enabled: true
  host: api.example.com
  tls: true
  paths: [/v1, /health]
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
valkey: { enabled: false }              # use an external Valkey / operator
```

Demo (`values-demo.yaml`):

```yaml
backend:
  replicaCount: 1
  env:
    MAX_CONCURRENT_COMPILES: "2"
  resources: { limits: { cpu: "1", memory: 512Mi } }
frontend:
  enabled: true
  apiBaseUrl: ""                        # same origin via the ingress
ingress:
  enabled: true
  host: demo.example.com
  tls: true
  annotations:
    nginx.ingress.kubernetes.io/limit-rpm: "60"
    nginx.ingress.kubernetes.io/proxy-body-size: 2m
```

## Open design points

1. **Frontend `VITE_API_BASE_URL` is a build-time value.** The image needs either a rebuild per environment or a small change so the URL is read at container start (for example generating a `config.js` from an environment variable in the nginx entrypoint). Recommended: same-origin via the ingress with an empty base URL, which needs no per-environment build.
2. **Token management.** `tokens create` is a CLI command of the backend binary. Use `kubectl exec` into a backend pod (tokens are shown only once, so a Job's log is a fragile place to keep them); purchased tokens are normally created by the Stripe webhook.
3. **Database migrations.** The schema is created idempotently at start; a future migration tool (for example sqlx migrations) would need an init container or hook.
4. **Rate limiting at the ingress.** The backend limits per key; add ingress limits (per IP) for the demo and as a safety net in production.
5. **Non-root image.** The Dockerfile should drop root before it is used with a restrictive `securityContext` (`runAsNonRoot`, `readOnlyRootFilesystem`).
6. **Image publishing.** CI to build and push both images (tags per release), `helm lint` / `helm template` checks, then chart publishing (OCI registry).
7. **Observability.** Add a metrics endpoint (Prometheus) and structured request logs before relying on autoscaling and per-customer dashboards.
8. **Secrets.** Use an external secrets operator or sealed secrets rather than plaintext values files.

## Suggested implementation order

1. Non-root Dockerfile and a runtime-configurable frontend URL.
2. CI that publishes images.
3. Chart skeleton: backend `Deployment`, `Service`, `Ingress`, secrets; install on a local cluster (kind or minikube) with the in-cluster Valkey.
4. Add probes, HPA, PDB and network policies.
5. Demo values and verification; production values and a load test (many `/v1/invoices/bulk` requests) to tune CPU limits and `MAX_CONCURRENT_COMPILES`.
