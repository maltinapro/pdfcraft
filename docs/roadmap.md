# Roadmap

Derived from the business plan ("Businessplan PDFCraft", digitalrechnung.jetzt, section 5 "Monetarisierung" and section 7 "Produkt-Roadmap"). It lists the **product changes** the plan asks for; marketing, finance and sales activities that need no product change are not part of it.

Status: `open` · `in progress` · `done`. After every finished epic or issue, update this file and the epic file. Conventions and GitHub workflow: [epics/README.md](epics/README.md).

GitHub issues are created **phase by phase** (epic issue + one sub-issue per task, labels `epic` / `task` / `phase-N`). Created so far: none.

## Phases

| Phase | Theme | Plan reference | Epics |
| --- | --- | --- | --- |
| 0 | Foundations: decisions, legal, quota model | Sections 5, 9 | E00, E01, E02 |
| 1 | Conversion and monetization | Q1 | E03, E04, E05, E06 |
| 2 | Convenience and organic traffic | Q2 | E07, E08, E09 |
| 3 | B2B and enterprise features | Q3–Q4 | E10, E11, E12 |
| 4 | Enterprise offer and services | Sections 5, 6 | E13, E14 |

## Epics

| Epic | Title | Phase | Depends on | Status |
| --- | --- | --- | --- | --- |
| [E00](epics/E00-product-decisions.md) | Product decisions and business-plan alignment | 0 | – | open |
| [E01](epics/E01-legal-compliance.md) | Legal, compliance and liability | 0 | E00 | open |
| [E02](epics/E02-quota-plan-model.md) | Quota and plan model (backend) | 0 | E00 | open |
| [E03](epics/E03-pricing-checkout.md) | Pricing, plans and checkout | 1 | E00, E01, E02 | open |
| [E04](epics/E04-token-dashboard.md) | Self-service token dashboard | 1 | E02 | open |
| [E05](epics/E05-seo-landing-pages.md) | SEO landing pages and content | 1 | E00 | open |
| [E06](epics/E06-developer-onboarding.md) | Developer onboarding and API docs | 1 | E02 | open |
| [E07](epics/E07-customer-article-master-data.md) | Customer and article master data | 2 | – | open |
| [E08](epics/E08-einvoice-viewer.md) | E-invoice viewer and checker | 2 | E01 | open |
| [E09](epics/E09-data-safety-sync.md) | Data safety and optional sync | 2 | E07 | open |
| [E10](epics/E10-pades-signatures.md) | PAdES signatures | 3 | E00, E01 | open |
| [E11](epics/E11-template-designs.md) | Additional template designs | 3 | E00 | open |
| [E12](epics/E12-production-helm-chart.md) | Production Helm chart (high availability) | 3 | E02 | open |
| [E13](epics/E13-enterprise-offer.md) | Enterprise self-hosted offer and support | 4 | E01, E12 | open |
| [E14](epics/E14-custom-template-service.md) | Custom template service | 4 | E11 | open |

## Recommended order

1. **Phase 0** first: E00 (decisions) unblocks everything; E01 and E02 can run in parallel afterwards. Nothing that sells plans (E03) should ship before E01 (terms, liability) and E02 (quotas) are done.
2. **Phase 1**: E02 → E03 → E04; E05 and E06 are independent and can start as soon as E00 is decided (E06 benefits from E02's quota headers).
3. **Phase 2**: E07 first (E09 backs up its data); E08 is independent and is the main SEO lever.
4. **Phase 3**: E10 needs the license decision of E00-05; E11 before E14; E12 can run any time after E02.
5. **Phase 4** once the first enterprise or custom-template lead exists; building it earlier is speculative.

## Plan items without an epic

- Marketing channels (Reddit, Hacker News, Heise), content writing and the finance plan are business tasks. Their product prerequisites (landing pages, benchmark, OpenAPI, quickstart) are in E05 and E06.
- Price levels and customer numbers of the plan are assumptions; E00 turns them into decisions.
