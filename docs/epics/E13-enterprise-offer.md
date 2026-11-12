# E13 – Enterprise self-hosted offer and support

**Phase:** 4 · **Depends on:** E01, E12 · **Business plan:** section 5.3 · **Status:** open

## Goal
Make "Enterprise Self-Hosted" (plan: 249 €/month, billed yearly) a concrete, deliverable offer: support and update commitment, a ready-to-run production setup, SLA, and a compliance package for the customer's audit. The code stays MIT; customers pay for support and assurance.

## Context / links
- E12 (production chart), E01-06/E01-07 (validation evidence), E10 (PAdES), E14 (custom templates), [06 Production](../06-production.md).

## Definition of done
- A written offer, contract template, support process and compliance package exist; a customer can run PDFCraft self-hosted without Mollie/Anubis and without outbound network access.

## Issues
- [ ] **E13-01 Offer definition** – Scope, price, billing (yearly invoice), included updates, support channels, response times, exclusions, and a contract template (to be reviewed by a lawyer). AC: offer one-pager and contract draft in the repo.
- [ ] **E13-02 Entitlement model** – Decide how customers receive support and updates (public images stay public; support entitlement by contract, optional private registry mirror) and whether any technical license check is needed. AC: decision record; no feature crippling of the MIT core.
- [ ] **E13-03 Compliance package** – Per release: validator results (Mustang/KoSIT versions), supported standard versions, PDF/A-3b report, release notes, packaged from CI. AC: downloadable artifact on each release; contents described in the offer.
- [ ] **E13-04 Self-hosted profile without public-shop features** – Document and test a profile with internal tokens only (no Mollie, no Anubis, no public free token), and operation without outbound network access (embedded fonts, vendored packages, no external requests). AC: air-gapped smoke test documented; Compose and Helm values for the profile.
- [ ] **E13-05 Security documentation** – `SECURITY.md` (reporting, supported versions), hardening guide, dependency audit in CI (`cargo audit`/`deny`, `npm audit`), threat model summary. AC: CI job green; documents linked from the offer.
- [ ] **E13-06 Release and LTS policy** – Semantic versions, support window per release, upgrade notes, deprecation policy. AC: policy page; the release workflow produces matching notes.
- [ ] **E13-07 SLA and support process** – Severity levels, channels, runbooks, status communication, incident template. AC: process document; alert rules map to severities.
- [ ] **E13-08 Enterprise page** – Static page (E05 template) with offer, FAQ and contact (E03-06). AC: claims verified (E00-06); in the sitemap.

## Open questions
- Is a technical license key ever needed, or is a support contract enough (MIT)?
