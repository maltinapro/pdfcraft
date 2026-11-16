# E10 – Landing and static pages

**Phase:** 4 · **Depends on:** E07-01 · **Status:** done · **GitHub:** [#180](https://github.com/maltinapro/pdfcraft/issues/180)

## Goal
Align the landing page, SEO pages, legal pages and the API reference with the new design language, so the step from the website into the app feels like one product, while the pages stay static, fast and free of external requests.

## Context / links
- [Design guide](../16-design-guide.md) sections 4, 6, 7.
- Today: `frontend/index.html` + `landing.css`, SEO pages (`zugferd-rechnung-erstellen/`, `xrechnung-generator/`, `stornorechnung-gutschrift-e-rechnung/`, `e-rechnungspflicht/`, `zugferd-xrechnung-pruefen/`), legal pages (`impressum.html`, `datenschutz.html`, `agb.html`, `widerruf.html`), `api/index.html` + `apiReference.css`, shared footer `partials/site-footer.html`.

## Definition of done
- All static pages use the tokens and type scale, have a header that does not wrap on mobile, and reach Lighthouse performance and accessibility ≥ 95 on mobile.

## Issues
- [x] **E10-01 Shared header and footer** – Static header partial (logo, "Open app", menu on compact) inserted like the footer by `vite.config.ts`; footer restyled. AC: no wrapping at 320 px; works without JavaScript. GitHub: [#181](https://github.com/maltinapro/pdfcraft/issues/181).
- [x] **E10-02 Landing page** – Restructure around the zone concept: hero with an animated A4 sheet showing the four zones (CSS/SVG only, reduced motion respected), three benefits, how it works in four steps, pricing, FAQ; legal and privacy statements unchanged in substance. AC: Lighthouse ≥ 95 (mobile); claims limited to what the product verifies (guide section 1.6). GitHub: [#182](https://github.com/maltinapro/pdfcraft/issues/182).
- [x] **E10-03 SEO, legal and API pages** – Apply tokens and components to the content pages (`.page-header`, `.faq`, `.notice`) and the Swagger UI theme. AC: JSON-LD, canonical URLs and sitemap unchanged; screenshots DE, light/dark, 390/1440 px. GitHub: [#183](https://github.com/maltinapro/pdfcraft/issues/183).
