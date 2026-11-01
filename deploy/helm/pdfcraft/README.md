# PDFCraft Helm chart (demo system)

Minimal chart for the **demo system** on a k3s cluster: frontend (nginx), backend, and one Ingress (Traefik) with a cert-manager certificate. It also deploys **Valkey** (StatefulSet with a persistent volume, append-only file) for tokens and rate limits; `/v1` works with tokens created via `tokens create-free` / `tokens create` (`kubectl exec` into the backend pod). See [Demo System](../../../docs/07-demo-system.md).

Routing on one host (same origin, no CORS):

| Path | Service |
| --- | --- |
| `/v1/*` | backend (no Anubis, token protected) |
| `/` (landing page, `/app/`) | Anubis → frontend |

Anubis (`templates/anubis.yaml`, policy in `files/botPolicy.yaml`) needs an Ed25519 key pair: run `pdfcraft-backend anubis-keygen` (e.g. `docker run --rm ghcr.io/maltinapro/pdfcraft-backend:<tag> anubis-keygen`) and set `anubis.privateKeyHex` (or `anubis.existingSecret` with key `ED25519_PRIVATE_KEY_HEX`) and `anubis.publicKeyHex`. See [Free token and Anubis](../../../docs/11-free-token-and-anubis.md).

Purchased tokens stay off until you set `backend.env.PAID_TOKENS_ENABLED: "true"` and `backend.stripeSecret` (a Secret with the key `STRIPE_WEBHOOK_SECRET`); see [Purchased Tokens (Stripe)](../../../docs/12-paid-tokens-stripe.md).

## Releasing (images and chart)

The workflow `.github/workflows/release-images.yml` builds and publishes both images and the chart. It runs in two ways.

### 1. GitHub release (recommended)

1. On GitHub: Releases → **Draft a new release** → create a tag like `v0.1.0` on `main` → *Generate release notes* → **Publish release**. (Tags must look like `vX.Y.Z` or `vX.Y.Z-rc.1`, otherwise the workflow fails.)
2. The workflow builds the tagged commit and publishes:

| Artifact | Tags / version |
| --- | --- |
| `ghcr.io/maltinapro/pdfcraft-backend` and `-frontend` | `0.1.0`, `0.1` and the short commit SHA; `latest` as well unless the release is marked *pre-release* (`0.1` is not set for `-rc` versions) |
| `oci://ghcr.io/maltinapro/charts/pdfcraft` | chart `version` and `appVersion` = `0.1.0` |

Chart and images share one version, so `--version 0.1.0` installs exactly the images of release `v0.1.0`. The `version` in `Chart.yaml` in the repository is only a placeholder; the workflow overwrites it.

### 2. Manual run (tests, intermediate builds)

Actions → "Release images" → Run workflow, with `tag` (for example `dev`) and `chart_version` (SemVer). It builds the selected branch; chart `appVersion` becomes the tag.

### Images

- `ghcr.io/maltinapro/pdfcraft-backend`
- `ghcr.io/maltinapro/pdfcraft-frontend` (built with an empty `VITE_API_BASE_URL`, so it calls `/v1` on its own host)

Both images are **multi-arch** (`linux/amd64` and `linux/arm64`) under a single tag. The backend is compiled natively on a GitHub-hosted ARM runner (`ubuntu-24.04-arm`) instead of QEMU, which would take hours for Rust/Typst; the frontend build stage always runs on the build machine because its output is architecture independent. `helm-lint.yml` lints the chart on pull requests that touch `deploy/`.

**One-time step:** new GHCR packages are private. Make both images public so the cluster can pull without credentials: GitHub → your profile → Packages → the package → Package settings → Change visibility → Public. If you keep them private, create an image pull secret and add `imagePullSecrets` to the chart (not supported yet).

## Chart in GHCR (OCI)

The workflow publishes the chart after the images were built (see above).

Result: `oci://ghcr.io/maltinapro/charts/pdfcraft`. **One-time step:** set the package `charts/pdfcraft` to *Public* (Packages → Package settings → Change visibility), like the images; otherwise `helm` needs a login.

## Install

Prerequisites: k3s with Traefik (default), cert-manager with a `ClusterIssuer`, a DNS record `pdfcraft.vorneweg.org` pointing at the cluster, and the Helm CLI.

### From GHCR (recommended)

OCI charts need no `helm repo add`. Pass the full `oci://` URL and a version. Create a values file once (`demo.yaml`):

```yaml
ingress:
  host: pdfcraft.vorneweg.org
  clusterIssuer: <your-cluster-issuer>   # kubectl get clusterissuer
anubis:
  privateKeyHex: <from anubis-keygen>
  publicKeyHex: <from anubis-keygen>
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

See `values.yaml`: image registry/tag (empty tag = the chart's `appVersion`), replicas and resources, `backend.env` (default `MAX_CONCURRENT_COMPILES=2`), ingress host, class, TLS secret and ClusterIssuer.

## Not included yet

- **Valkey operator / HA**: the chart runs one Valkey pod with a PVC (`valkey.persistence.size`, `valkey.persistence.storageClass`). That is enough for the demo: a few KB of tokens, restarts keep the data. For HA, snapshots and backups use an external Valkey or a Valkey operator: set `valkey.enabled=false` and `backend.env.VALKEY_URL`. See [Production](../../../docs/06-production.md).
- **Per-IP rate limit** for `/v1/free-token` and `/v1/invoices`: recommended at the edge (Cloudflare rate-limiting rule), see [Demo System](../../../docs/07-demo-system.md#where-to-rate-limit-application-vs-edge); optionally a Traefik `Middleware` as a second layer. Currently only the compile limit and pod resource limits protect the demo.
- Pinned image tags and automatic deployment from GitHub Actions (would need a kubeconfig secret).
- Non-root images, NetworkPolicy, autoscaling, monitoring.
- Image pull secrets for private registries.
