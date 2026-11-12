# E03 – SEO landing pages

**Phase:** 1 · **Depends on:** – · **Status:** open

## Goal
Search traffic is the plan's main acquisition channel. The site is one landing page (`frontend/index.html`) with a single sitemap entry. Add a small set of static, keyword-focused pages that lead into the configurator.

## Context / links
- Already in place: title, meta description, Open Graph, JSON-LD `SoftwareApplication`, `robots.txt` on `index.html`. Missing: more pages and sitemap entries.
- Static multi-page build: `frontend/vite.config.ts` (inputs), `frontend/public/sitemap.xml`, `landing.css`, legal pages `impressum.html` etc.

## Definition of done
- Four product pages and one deadlines page are live, in the sitemap, and each links into the matching form.

## Issues
- [ ] **E03-01 Page scaffold** – Reuse the landing header/footer/styles for new pages; register them in `vite.config.ts` and `sitemap.xml`. AC: a new page needs one HTML file plus two list entries; each page has its own title, description and canonical URL.
- [ ] **E03-02 Four product pages** – "ZUGFeRD-Rechnung erstellen", "XRechnung erstellen", "Stornorechnung / Gutschrift erstellen", "Rechnungsvorlage mit Logo". Each: one H1, short explanation, FAQ with `FAQPage` JSON-LD, call to action to `/app/#/<type>`. AC: only claims the product backs up (see E01); no keyword stuffing.
- [ ] **E03-03 E-Rechnungspflicht page** – Deadlines (receiving since 2025, issuing transition until end of 2026/2027, from 2028 for everyone) and what the product covers. AC: facts checked against the official BMF letter and linked; date of last check on the page.
- [ ] **E03-04 Links and news** – Link the pages from the landing page and footer, add a "Neuigkeiten" entry. AC: no orphan pages; `README.md` mentions the pages.

## Open questions
- Stop after these pages and check Search Console data before writing more; further pages only if these get impressions.
