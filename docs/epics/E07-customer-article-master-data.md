# E07 – Customer and article master data

**Phase:** 2 · **Depends on:** – · **Business plan:** section 7 (Q2) · **Status:** open

## Goal
Besides the last documents, recurring recipients and standard services/articles can be saved in the browser (`localStorage`) and reused in every document type. Everything stays local; the server never sees the master data except as part of a normal render request.

## Context / links
- `frontend/src/lib/storage.ts` (versioned config), `lib/archive.ts` (archive), `lib/backup.ts` and `components/DataPage.tsx` (backup/restore), `lib/documents.ts` (`DOC_SPECS`), `components/ItemsEditor.tsx`, `components/DocumentForm.tsx`, `lib/types.ts`.

## Definition of done
- Recipients and articles can be created, edited, deleted, searched and picked in all document forms; they are part of backup/restore and survive schema migrations.

## Issues
- [ ] **E07-01 Data model and storage** – Versioned `pdfcraft.masterdata` (`schemaVersion`, recipients, articles) with migration hook, validation on load, size guard for the `localStorage` budget. AC: unit tests for parse/merge/migrate; unknown newer versions are rejected like `parseConfig`.
- [ ] **E07-02 Backup integration** – Include master data in the backup file (`backup.ts`), import with merge/replace choice, bump the backup version if needed. AC: round-trip test; old backups still import.
- [ ] **E07-03 Recipient management** – Page `#/contacts`: list, search, create, edit, delete; fields as in the recipient form (name, address, country, VAT ID, e-mail, buyer reference/Leitweg-ID, preferred document language, default payment terms). AC: DE/EN, dark, narrow; field validation reuses `validate.ts` rules (VAT ID, e-mail).
- [ ] **E07-04 Recipient picker and "save recipient"** – In every document form: search/pick a recipient and fill the form; "Save as recipient" from the current document; update an existing recipient on request. AC: works for invoice, credit note, offer, order, delivery note and letter; field keys for validation unchanged.
- [ ] **E07-05 Article management** – CRUD for standard services/articles: description, unit code (UN/ECE as used by the e-invoice), unit price, tax rate, 0 % exemption reason. AC: unit codes validated against the list the backend accepts.
- [ ] **E07-06 Article picker in items** – Add from the master data in `ItemsEditor`, keep manual rows; changing a saved article does not alter issued documents (archive snapshots are final). AC: sorting/drag and drop of items unchanged.
- [ ] **E07-07 Seed from archive** – Offer "create recipients/articles from my issued documents" using the archive. AC: de-duplicates by name + address; nothing leaves the browser.
- [ ] **E07-08 CSV import/export** – Import recipients/articles from CSV (documented columns, preview before import, encoding/semicolon handling) and export. AC: sample files in `docs/`; invalid rows reported per line.
- [ ] **E07-09 Bulk with contacts (optional)** – Select several recipients and create one document for each as a bulk ZIP (reuses `POST /v1/documents/bulk`). AC: respects the plan's bulk maximum (`bulkMax`).
- [ ] **E07-10 Storage limits** – Show storage use; decide whether to move the archive and master data to IndexedDB if `localStorage` (≈ 5 MB) becomes the limit. AC: decision in `decisions.md` with measurements (for example 1,000 recipients, 500 documents).
- [ ] **E07-11 Docs and news** – README feature list, docs, "Neuigkeiten". AC: texts in DE/EN.

## Open questions
- Share master data across devices only through backup files (E09), or is sync required earlier?
