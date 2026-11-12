# E01 – Legal, compliance and liability

**Phase:** 0 · **Depends on:** E00 · **Business plan:** section 9 (risk 3), section 5 · **Status:** open

## Goal
Make the terms, the in-app wording and the technical evidence match the new offers: clear liability split (§ 14 UStG stays with the issuer), terms for API customers, an invoice for token purchases, and automated proof that generated e-invoices are valid.

## Context / links
- Existing drafts: `frontend/agb.html`, `widerruf.html`, `datenschutz.html`, `impressum.html` (not reviewed by a lawyer, see AGENTS.md steps 43 and 45).
- Open since step 45: buyers get no invoice for their purchase (no customer data is collected, Mollie sends none).
- Mustang 2.26.0 validation was run manually; `.github/workflows/ci.yml` does not validate e-invoices.

## Definition of done
- Terms, privacy policy and in-app notices cover token buyers and API customers and state the liability split.
- Purchases can be invoiced without the server keeping customer data.
- CI fails when a generated e-invoice (EN 16931, XRechnung, credit note) is invalid.

## Issues
- [ ] **E01-01 Terms for API and business customers** – Extend the terms for B2B use: quotas and fair use, no SLA for self-service plans, price changes, termination, subscriptions, statelessness. AC: updated `agb.html`; text marked as draft until reviewed by a lawyer.
- [ ] **E01-02 Liability notice (§ 14 UStG)** – State that PDFCraft is a technical aid and the issuer remains responsible for the invoice contents. AC: sentence in the terms, in the e-invoice hints panel of the app, on the buy page and on the landing/SEO pages (E05); DE and EN.
- [ ] **E01-03 Invoice for token purchases** – Let buyers optionally enter billing data (name, address, VAT ID) at checkout and produce the purchase invoice with PDFCraft itself (dogfooding, e-invoice XML included), shown/downloadable once like the token. AC: no billing data stored on the server beyond what Mollie and the law require (document the retention needed for our own bookkeeping); tested with the Mollie mock.
- [ ] **E01-04 Tax and price presentation review** – Document the VAT treatment (small-business rule or standard), price display rules for consumers and businesses, and the invoice requirements for our own sales. AC: checklist in `docs/06-production.md` go-live section; open items listed for the tax advisor.
- [ ] **E01-05 Data-processing agreement and sub-processors** – Provide an AVV template for API customers and list sub-processors (hosting, Mollie, Deutsche Post). AC: template in the repo, privacy policy lists the sub-processors, wording states that no customer documents are stored.
- [ ] **E01-06 Automated e-invoice validation in CI** – Run Mustang (and, if feasible, KoSIT validator) in CI against rendered golden documents: EN 16931 invoice, XRechnung, credit note (TypeCode 381), 0 % with exemption, several tax rates. AC: CI job fails on any validation error; validator versions pinned and printed; documented in `docs/10-architecture-and-extending.md`.
- [ ] **E01-07 Conformity statement** – Publish which standards and versions the output is validated against, with the CI result of the last release (basis for the enterprise compliance package in E13-03). AC: generated `docs/` page or release asset; linked from the landing page.

## Open questions
- Which legal review (lawyer, tax advisor) is booked before the new plans go live?
- Is a purchase invoice needed for consumers who pay small amounts, or only on request?
