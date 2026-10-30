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

Both images are **multi-arch** (`linux/amd64` and `linux/arm64`) under a single tag, so the same chart runs on x86 and ARM nodes. The backend is compiled natively on a GitHub-hosted ARM runner (`ubuntu-24.04-arm`, free for public repositories) instead of QEMU, which would take hours for Rust/Typst; the frontend build stage always runs on the build machine because its output is architecture independent.

Tags: the tag you entered and the short commit SHA of the selected branch. A separate workflow (`helm-lint.yml`) runs `helm lint` and `helm template` on pull requests that touch `deploy/`. Nothing is built automatically on push; to deploy, run the workflow and then restart the pods (see Install).

**One-time step:** new GHCR packages are private. Make both public so the cluster can pull without credentials: GitHub → your profile → Packages → the package → Package settings → Change visibility → Public. If you keep them private instead, create an image pull secret and add `imagePullSecrets` to the chart (not supported yet).

## Chart in GHCR (OCI)

The same manual workflow also publishes the chart as an OCI artifact after the images were built. Inputs of "Run workflow":

- `tag`: image tag (default `latest`); it becomes the chart's `appVersion`, so the chart installs exactly these images.
- `chart_version`: chart version, SemVer (default `0.1.0`). Re-using a version overwrites it; use a new version for each release you want to pin.

Result: `oci://ghcr.io/maltinapro/charts/pdfcraft`. **One-time step:** set the package `charts/pdfcraft` to *Public* (Packages → Package settings → Change visibility), like the images; otherwise `helm` needs a login.

## Install

Prerequisites: k3s with Traefik (default), cert-manager with a `ClusterIssuer`, a DNS record `pdfcraft.vorneweg.org` pointing at the cluster, and the Helm CLI.

### From GHCR (recommended)

OCI charts need no `helm repo add`. Pass the full `oci://` URL and a version. Create a values file once (`demo.yaml`):

```yaml
ingress:
  host: pdfcraft.vorneweg.org
  clusterIssuer: <your-cluster-issuer>   # kubectl get clusterissuer
```

```bash
helm upgrade --install pdfcraft oci://ghcr.io/maltinapro/charts/pdfcraft \
  --version 0.1.0 -n pdfcraft --create-namespace -f demo.yaml
```

Inspect first (optional): `helm show values oci://ghcr.io/maltinapro/charts/pdfcraft --version 0.1.0`. If the package is private: `helm registry login ghcr.io -u <github-user>` with a personal access token that has `read:packages`.

Upgrade to a new release: run the workflow with a new `chart_version`, then repeat the command with the new `--version`.

### From a local checkout

```bash
helm upgrade --install pdfcraft deploy/helm/pdfcraft \
  -n pdfcraft --create-namespace \
  -f deploy/helm/pdfcraft/values-demo.yaml \
  --set ingress.clusterIssuer=<your-cluster-issuer>
```

### Directly from k3s (no Helm CLI; Untested)

k3s ships a Helm controller. Apply this manifest on the cluster; it installs and keeps the release:

```yaml
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: pdfcraft
  namespace: kube-system
spec:
  chart: oci://ghcr.io/maltinapro/charts/pdfcraft
  version: 0.1.0
  targetNamespace: pdfcraft
  createNamespace: true
  valuesContent: |-
    ingress:
      host: pdfcraft.vorneweg.org
      clusterIssuer: <your-cluster-issuer>
```

Argo CD and Flux can use the same OCI URL as a Helm source.

`ingress.clusterIssuer` defaults to `letsencrypt-prod`. When the images use a moving tag such as `latest` (`pullPolicy: Always`), roll out new images with:

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

See `values.yaml`: image registry/tag (empty tag = the chart's `appVersion`), replicas and resources, `backend.env` (defaults `ENABLE_GENERATE_PDF=true`, `MAX_CONCURRENT_COMPILES=2`), ingress host, class, TLS secret and ClusterIssuer.

## Not included yet

- **Secrets / Postgres / Redis**: not needed for the demo. For the production API, Postgres and Redis will be created with Kubernetes operators (for example CloudNativePG and a Redis operator) and their connection strings passed as `DATABASE_URL` / `REDIS_URL` from a Secret. See [Production](../../../docs/06-production.md).
- **Per-IP rate limit** for `/generate-pdf`: recommended at the edge (Cloudflare rate-limiting rule), see [Demo System](../../../docs/07-demo-system.md#where-to-rate-limit-application-vs-edge); optionally a Traefik `Middleware` as a second layer. Currently only the compile limit and pod resource limits protect the demo.
- Pinned image tags and automatic deployment from GitHub Actions (would need a kubeconfig secret).
- Non-root images, NetworkPolicy, autoscaling, monitoring.
- Image pull secrets for private registries.
