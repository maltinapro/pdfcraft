# E12 – Production Helm chart (high availability)

**Phase:** 3 · **Depends on:** E02 (plan config in values) · **Business plan:** section 7 (Q3–Q4) · **Status:** open

## Goal
Complete the Kubernetes chart for production and enterprise customers: hardened, highly available, documented upgrades and a validated load profile. A demo chart already exists; the production outlook is described but not implemented.

## Context / links
- [08 Kubernetes / Helm (Outlook)](../08-kubernetes-helm-outlook.md) (layout, open design points, implementation order), `deploy/helm/pdfcraft/` (backend, frontend, Anubis, Valkey StatefulSet, ingress, optional PodMonitor/PrometheusRule/Grafana dashboards), `.github/workflows/helm-lint.yml`, `release-images.yml` (OCI chart in GHCR).

## Definition of done
- `helm install` with `values-production.yaml` gives a highly available deployment that survives node maintenance, with documented upgrade/rollback and a load test that sizes the CPU limits.

## Issues
- [ ] **E12-01 Hardened images** – Non-root user, `readOnlyRootFilesystem`, dropped capabilities, `seccompProfile: RuntimeDefault`; chart `securityContext` defaults match. AC: pods start under the restricted Pod Security level; writable paths (if any) are `emptyDir`.
- [ ] **E12-02 Runtime-configurable frontend URL** – Remove the build-time-only `VITE_API_BASE_URL` constraint (same-origin default, or a `config.js` generated at container start). AC: one frontend image works for every environment.
- [ ] **E12-03 Scaling** – HorizontalPodAutoscaler on CPU, `PodDisruptionBudget`, topology spread, `MAX_CONCURRENT_COMPILES` derived from the CPU limit. AC: rolling update without failed requests (test with a running load).
- [ ] **E12-04 NetworkPolicy** – Only ingress → backend, backend → Valkey, metrics scrape from the monitoring namespace, Anubis → frontend. AC: policy tests (connections that must fail do fail).
- [ ] **E12-05 Highly available Valkey** – Support an external Valkey or a Valkey operator/Sentinel setup; document backup of token data and failover behavior (rate-limit fallback when Valkey is down, see `store.rs`). AC: failover test documented.
- [ ] **E12-06 Secrets** – `existingSecret` for all secrets (`MOLLIE_API_KEY`, `ANUBIS_*`, Valkey URL), documentation for external-secrets/sealed-secrets. AC: no plaintext secrets in `values.yaml` examples.
- [ ] **E12-07 Values for production and demo** – `values-production.yaml` (API only, no frontend/Anubis) and `values-demo.yaml` as in the outlook; ingress limits per IP as a safety net. AC: both `helm lint` and `helm template` run in CI.
- [ ] **E12-08 Chart tests in CI** – Install the chart on a kind cluster in CI and smoke-test `/health` and one PDF request. AC: workflow green on PRs touching `deploy/`.
- [ ] **E12-09 Load test and sizing** – Reproducible load test (`/v1/invoices`, bulk) to confirm the guidance in `docs/05` and set default requests/limits. AC: results and the script in the repo.
- [ ] **E12-10 Supply chain** – SBOM, image signing (cosign) and vulnerability scan in `release-images.yml`; chart provenance. AC: verifiable in the release workflow.
- [ ] **E12-11 Operations docs** – Install, upgrade, rollback, backup of Valkey, alerts (existing PrometheusRule), runbooks; update `08` from "outlook" to a guide. AC: guide tested on a local cluster.

## Open questions
- Which Kubernetes versions and distributions are supported (k3s today)?
