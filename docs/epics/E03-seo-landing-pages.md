# E03 – SEO landing pages

**Phase:** 1 · **Depends on:** – · **Status:** in progress (Internetmarke page and the check of the deadlines page against the BMF letter are open)

## Goal
Search traffic is the plan's main acquisition channel. The site is one landing page (`frontend/index.html`) with a single sitemap entry. Add a small set of static, keyword-focused pages that lead into the configurator.

## Context / links
- Already in place: title, meta description, Open Graph, JSON-LD `SoftwareApplication`, `robots.txt` on `index.html`. Missing: more pages and sitemap entries.
- Static multi-page build: `frontend/vite.config.ts` (inputs), `frontend/public/sitemap.xml`, `landing.css`, legal pages `impressum.html` etc.

## Definition of done
- The product pages for the plan's four keywords (Internetmarke page once the feature is verified) and one deadlines page are live, in the sitemap, and each links into the matching form.

## Issues
- [x] **E03-01 Page scaffold** – Reuse the landing header/footer/styles for new pages; register them in `vite.config.ts` and `sitemap.xml`. AC: a new page needs one HTML file plus two list entries; each page has its own title, description and canonical URL.
- [ ] **E03-02 Four product pages** – The four keywords of the business plan: "ZUGFeRD-Rechnung kostenlos online erstellen", "XRechnung Generator für Kleinunternehmer & Freelancer", "Stornorechnung / Gutschrift als E-Rechnung (TypeCode 381)", "DIN 5008 Brief online schreiben mit Internetmarke". Each: one H1, short explanation, FAQ with `FAQPage` JSON-LD, call to action to `/app/#/<type>`. AC: only claims the product backs up (see E01); "kostenlos testen", not "kostenlos ohne Anmeldung" without the watermark hint (free PDFs carry "Entwurf"); no keyword stuffing. The Internetmarke page goes live only when the feature is enabled and verified against the live Deutsche Post API (`INTERNETMARKE_ENABLED` is off by default and was only tested against the mock, see [14](../14-internetmarke-integration.md)); until then publish the other three. *Status: ZUGFeRD, XRechnung and Stornorechnung pages are published (`/zugferd-rechnung-erstellen/`, `/xrechnung-generator/`, `/stornorechnung-gutschrift-e-rechnung/`); the Internetmarke page is still open, so this item stays unticked.*
- [ ] **E03-03 E-Rechnungspflicht page** – Deadlines (receiving since 2025, issuing transition until end of 2026/2027, from 2028 for everyone) and what the product covers. AC: facts checked against the official BMF letter and linked; date of last check on the page. *Status: page `/e-rechnungspflicht/` is published with a "Stand" date. The source link is the BMF letter as hosted by the ZDH (`https://www.zdh.de/fileadmin/Oeffentlich/Steuern_und_Finanzen/Themen/E-Rechnung/20261015_BMF-Schreiben_E-Rechnung_final.pdf`; the original BMF URL was unverified and removed). The page carries a visible note that its content is NOT yet checked against the letter, because it was written without access to the PDF (the sandbox could not reach it). Open: compare each date and exception with the letter, check the letter date (the file name suggests 15 Oct 2026), remove the note on the page and in this status, set the "Stand" date, then tick this item.*
- [x] **E03-04 Links and news** – Link the pages from the landing page and footer, add a "Neuigkeiten" entry. AC: no orphan pages; `README.md` mentions the pages.

## Open questions
- Stop after these pages and check Search Console data before writing more; further pages only if these get impressions.
