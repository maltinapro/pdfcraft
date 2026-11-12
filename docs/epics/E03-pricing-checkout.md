# E03 – Pricing, plans and checkout

**Phase:** 1 · **Depends on:** E00, E01, E02 · **Business plan:** section 5 · **Status:** open

## Goal
Offer the plan's three pillars to customers: Free/Demo, web "Freelancer" token and the API plans (Growth, Scale), plus a path to Enterprise and custom templates. Customers must understand what each plan contains and be able to buy, renew and change it.

## Context / links
- `backend/src/mollie.rs`, `PAID_PRICES`, `frontend/src/components/BuyPage.tsx`, `frontend/src/lib/purchase.ts`, [12 Paid tokens (Mollie)](../12-paid-tokens-mollie.md).
- Mollie subscriptions: maximum interval `365 days`; a running subscription keeps its amount.

## Definition of done
- All plans decided in E00 are purchasable in a test setup (Mollie mock) and documented; the buy page and a static pricing page show identical plans, limits and prices.
- Renewal, cancellation and plan change work; the funnel is measurable.

## Issues
- [ ] **E03-01 Configure offers** – Set `PAID_PRICES`/plans for Freelancer (yearly, monthly), API Growth and API Scale in env files, Compose mock env and Helm values. AC: `GET /v1/checkout/offers` lists them; tests with the Mollie mock cover one-off, subscription and renewal for each plan.
- [ ] **E03-02 Buy page redesign** – Plan comparison (Free, Freelancer, Growth, Scale, Enterprise contact): quota, rate limit, features, monthly/yearly choice, VAT note, the liability notice (E01-02). AC: DE/EN, dark mode and narrow width verified by screenshots; consent checkboxes of the terms stay.
- [ ] **E03-03 Static pricing page** – `frontend/preise.html` (Vite input, in the sitemap) with the same figures; a check prevents drift from the backend offers (for example a script comparing the page with the offers of the mock env). AC: landing page links to it; JSON-LD `Offer` data.
- [ ] **E03-04 Plan change** – Upgrade/downgrade of an existing token (for example web → API, Growth → Scale). Decide pro-rata handling; simplest acceptable approach: buy the new plan and migrate/replace the token and cancel the old subscription. AC: documented behavior; tested with the mock; no double billing.
- [ ] **E03-05 Expiry and renewal reminders** – Without e-mail addresses, remind inside the app (banner, header) before a one-off token expires. AC: reminder shown N days before expiry and on the dashboard (E04); dismissible; DE/EN.
- [ ] **E03-06 Enterprise and custom-template contact path** – Contact buttons with prefilled subject (`mailto:`) for Enterprise (E13) and Custom Template Setup (E14); no form and no data collected. AC: on pricing and buy page; privacy policy unchanged.
- [ ] **E03-07 Funnel metrics** – Add the missing KPI metrics from E00-07 (for example buy-page checkout started vs. completed) without personal data. AC: dashboard panels and `docs/13-observability.md` updated.
- [ ] **E03-08 Docs and news** – Update `12`, `05`, README feature list and add a "Neuigkeiten" entry. AC: documented local command for the full purchase flow.

## Open questions
- Free monthly quota as an additional lead magnet (E00 open question)?
- Are prices shown net or gross on the API plans (E00-02)?
