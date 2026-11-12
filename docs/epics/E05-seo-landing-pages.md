# E05 – SEO landing pages and content

**Phase:** 1 · **Depends on:** E00 (claims, E00-06) · **Business plan:** sections 6.1, 7 (Q1) · **Status:** open

## Goal
Rank for the plan's niche keywords around the e-invoice obligation with static, fast, truthful landing pages that lead into the app. The hash-routed app (`/app/#/…`) is not indexable, so every search intent needs its own static page.

## Context / links
- Existing: `frontend/index.html` (landing), `impressum.html`, `datenschutz.html`, `agb.html`, `widerruf.html`, `public/sitemap.xml`, `robots.txt`, Vite multi-page build (`frontend/vite.config.ts`), `landing.css`.
- Target keywords from the plan: "ZUGFeRD Rechnung kostenlos online erstellen ohne Anmeldung", "XRechnung Generator für Kleinunternehmer & Freelancer", "Stornorechnung / Gutschrift als E-Rechnung (TypeCode 381) erstellen", "DIN 5008 Brief online schreiben mit Internetmarke".

## Definition of done
- One static page per target keyword plus an e-invoice deadlines page, all in the sitemap, with correct metadata and structured data.
- A documented content strategy; claims on the pages are the approved ones of E00-06.

## Issues
- [ ] **E05-01 Content strategy** – `docs/16-seo-content-strategy.md`: keyword map, search intent and primary CTA per page, internal linking, update rhythm, measurement. AC: reviewed list of pages; claims reference E00-06.
- [ ] **E05-02 Shared page template** – Avoid copy-pasting HTML: shared header, footer, styles and a build-time page generator (or Vite plugin) for content pages. AC: new page = one content file; legal links and language are consistent; no external requests (fonts self-hosted).
- [ ] **E05-03 Four keyword pages** – ZUGFeRD without sign-up, XRechnung for small businesses and freelancers, credit note/Storno as e-invoice (TypeCode 381), DIN 5008 letter with Internetmarke. Each with explanation, honest limits, FAQ, a deep link into the matching app route and the liability notice (E01-02). AC: pages are accurate against the product (verified by trying the flow); DE (EN optional, see open questions).
- [ ] **E05-04 E-invoice deadlines page** – Obligation to receive since 2025, transitional periods, turnover thresholds for 2027 and 2028, with sources and "last checked" date. AC: figures verified against official sources (E00-06); date shown.
- [ ] **E05-05 Technical SEO** – Per-page title/description/canonical, Open Graph, `hreflang` if EN pages exist, JSON-LD (`FAQPage`, `SoftwareApplication`, `Organization`), sitemap generation including all pages, `robots.txt`. AC: structured data validates; Lighthouse performance and SEO ≥ 90 on every page.
- [ ] **E05-06 Landing page conversion** – Landing and SEO pages share a clear flow: try without sign-up → free token → buy. Add pricing teaser (E03-03). AC: CTA tracking via existing metrics only (no cookies or third-party scripts).
- [ ] **E05-07 Privacy-friendly measurement** – Search Console and, if wanted, self-hosted cookieless analytics; no third-party trackers. AC: privacy policy updated accordingly; decision recorded.
- [ ] **E05-08 Developer showcase** – "Rust + Typst in production: ZUGFeRD invoices in < 10 ms" article with reproducible benchmark method and numbers (E00-06), plus a short README section. AC: benchmark command and conditions are documented and runnable.
- [ ] **E05-09 News and docs** – Entry in "Neuigkeiten", README and docs updated. AC: links verified.

## Open questions
- English versions of the pages (the product UI is bilingual, the market in the plan is German)?
- Blog section or only evergreen pages?
