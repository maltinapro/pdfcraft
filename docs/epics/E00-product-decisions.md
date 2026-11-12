# E00 – Product decisions and business-plan alignment

**Phase:** 0 · **Depends on:** – · **Business plan:** sections 5, 8, 9 · **Status:** open

## Goal
Turn the open assumptions of the business plan into recorded decisions before any code depends on them: prices, what a "document" in a quota is, which plans exist, the license strategy and which claims may be used publicly.

## Context / links
- Current state: launch offers `starter:31=2.90`, `starter:365=24.00` (later 4.90 / 39.00), plans `starter=30,business=100,pro=300` invoices **per minute**, no monthly quota ([12](../12-paid-tokens-mollie.md), [05](../05-tokens-and-rate-limiting.md)).
- Plan: "Freelancer" 29 €/year or 3.90 €/month with up to 300 documents/month; "API Growth" 29 €/month (5,000 calls); "API Scale" 99 €/month (50,000 calls, priority); Enterprise 249 €/month; custom template 750 € once.

## Definition of done
- `docs/decisions.md` exists with numbered decisions (context, options, decision, consequences) for every issue below.
- The epics E02, E03, E10, E11, E13 and E14 are adjusted where a decision changes their scope.

## Issues
- [ ] **E00-01 Decision log** – Create `docs/decisions.md` with a short template and link it from `docs/README.md`. AC: file exists; later decisions are numbered `D-NN`.
- [ ] **E00-02 Reconcile prices** – Compare plan prices with the current offers (24 €/year and 2.90 €/month vs. 29 €/year and 3.90 €/month) and decide the launch and later prices, including VAT presentation (B2C incl. VAT, B2B net) and the small-business rule (§ 19 UStG). AC: decision with final `PAID_PRICES` values for all plans; note that running subscriptions keep their amount.
- [ ] **E00-03 Define "document" for quotas** – Decide what counts against a monthly quota: final PDF download vs. live preview, each document of a bulk request, postage stamps, the e-invoice checker (E08). Decide the period (calendar month vs. 31 days from purchase vs. token term) and the overage behavior (hard stop `429` vs. soft limit vs. paid top-up). AC: decision covers the preview problem (the live preview currently calls `POST /v1/invoices` with the same token) and abuse resistance.
- [ ] **E00-04 Plan catalog and token scope** – Map the plan's offers to technical plans (web "Freelancer", API "Growth", API "Scale", Enterprise) and decide whether web and API use are separate tokens or one token with both. AC: table of plan → rate limit per minute → monthly quota → bulk max → priority → features (Internetmarke, signatures, designs).
- [ ] **E00-05 License and commercial-module strategy** – Keep MIT for the core; decide which future features (PAdES, extra designs) stay in the open core and what would trigger a separate commercial module (risk 1 of the plan). AC: written decision with trigger criteria; consequences for E10 and E11.
- [ ] **E00-06 Verify public claims** – Source every claim used on pages or in outreach: e-invoice deadlines and turnover thresholds, "< 10 ms" (conditions, hardware, document size; reproducible with `cargo test --release bench_render -- --ignored --nocapture`), competitor prices, "Mustang-validated" (currently verified manually, see E01-06). AC: list of approved claims with source or benchmark; unverifiable claims are removed from the plan's copy.
- [ ] **E00-07 KPIs and funnel** – Define the KPIs without personal data: free tokens issued, PDFs per token kind, buy-page visits, checkouts started, paid, renewals, churn. AC: KPI list mapped to existing metrics (`docs/13-observability.md`) and the gaps that E03-07 closes.

## Open questions
- Is the "Freelancer" token the existing `starter` plan renamed, or a new plan next to it?
- Is a free monthly quota (for example 5 unwatermarked documents) a better lead magnet than watermarked drafts only?
