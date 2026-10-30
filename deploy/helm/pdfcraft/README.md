# PDFCraft Helm chart (demo system)

Minimal chart for the **demo system** on a k3s cluster: frontend (nginx), backend, and one Ingress (Traefik) with a cert-manager certificate. It deliberately has **no Postgres/Redis and no API keys**: `/v1` stays disabled (`503`), only the configurator and `POST /generate-pdf` work. See [Demo System](../../../docs/07-demo-system.md).

Routing on one host (same origin, no CORS):

| Path | Service |
| --- | --- |
| `/generate-pdf` | backend |
| `/` (landing page, `/app/`) | frontend |

## Images

The workflow `.github/workflows/release-images.yml` is **manual**: in GitHub go to Actions → "Release images" → Run workflow, enter a tag (default `latest`) and start it. It builds and pushes:

- `ghcr.io/maltinapro/pdfcraft-backend`
- `ghcr.io/maltinapro/pdfcraft-frontend` (built with an empty `VITE_API_BASE_URL`, so it calls `/generate-pdf` on its own host)

Tags: the tag you entered and the short commit SHA of the selected branch. A separate workflow (`helm-lint.yml`) runs `helm lint` and `helm template` on pull requests that touch `deploy/`. Nothing is built automatically on push; to deploy, run the workflow and then restart the pods (see Install).

**One-time step:** new GHCR packages are private. Make both public so the cluster can pull without credentials: GitHub → your profile → Packages → the package → Package settings → Change visibility → Public. If you keep them private instead, create an image pull secret and add `imagePullSecrets` to the chart (not supported yet).

## Install

Prerequisites: k3s with Traefik (default), cert-manager with a `ClusterIssuer`, and a DNS record `pdfcraft.vorneweg.org` pointing at the cluster.

```bash
helm upgrade --install pdfcraft deploy/helm/pdfcraft \
  -n pdfcraft --create-namespace \
  -f deploy/helm/pdfcraft/values-demo.yaml \
  --set ingress.clusterIssuer=<your-cluster-issuer>
```

`ingress.clusterIssuer` defaults to `letsencrypt-prod`; check yours with `kubectl get clusterissuer`. Because the images use the `latest` tag with `pullPolicy: Always`, roll out a new version with:

```bash
kubectl -n pdfcraft rollout restart deploy/pdfcraft-backend deploy/pdfcraft-frontend
```

Verify:

```bash
kubectl -n pdfcraft get pods,ingress,certificate
curl -sI https://pdfcraft.vorneweg.org/        # 200 with a valid certificate
```

Then open `https://pdfcraft.vorneweg.org/` (landing page) and `/app/` and check that the preview renders. `/health` is intentionally not exposed through the ingress.

## Values

See `values.yaml`: image registry/tag, replicas and resources, `backend.env` (defaults `ENABLE_GENERATE_PDF=true`, `MAX_CONCURRENT_COMPILES=2`), ingress host, class, TLS secret and ClusterIssuer.

## Not included yet

- **Secrets / Postgres / Redis**: not needed for the demo. For the production API, Postgres and Redis will be created with Kubernetes operators (for example CloudNativePG and a Redis operator) and their connection strings passed as `DATABASE_URL` / `REDIS_URL` from a Secret. See [Production](../../../docs/06-production.md).
- **Per-IP rate limit** for `/generate-pdf`: recommended at the edge (Cloudflare rate-limiting rule), see [Demo System](../../../docs/07-demo-system.md#where-to-rate-limit-application-vs-edge); optionally a Traefik `Middleware` as a second layer. Currently only the compile limit and pod resource limits protect the demo.
- Pinned image tags and automatic deployment from GitHub Actions (would need a kubeconfig secret).
- Non-root images, NetworkPolicy, autoscaling, monitoring.
- Image pull secrets for private registries.
