# E04 – Customer and article master data

**Phase:** 2 · **Depends on:** – · **Status:** done

## Goal
Recurring recipients and standard services have to be typed again for every document. Save them in the browser and pick them in all document forms. Everything stays in `localStorage`; the server never stores it.

## Context / links
- `frontend/src/lib/storage.ts` (versioned config), `archive.ts`, `backup.ts` (`BACKUP_VERSION` 1, "Daten & Sicherung" page), `documents.ts` (`DOC_SPECS`), `components/DocumentForm.tsx`, `ItemsEditor.tsx`, `lib/types.ts`.
- Today only the archive holds past recipients; there is no list to pick from.
- Not planned: CSV import/export, bulk with contacts, E2E-encrypted sync (the backup file already covers moving data; sync would mean customer data on the server).

## Definition of done
- Recipients and articles can be created, edited, deleted, searched and picked in every document type, and they are part of backup and restore.

## Issues
- [x] **E04-01 Storage and backup** – `lib/masterData.ts` with a versioned format in its own `localStorage` key; include it in the backup (`BACKUP_VERSION` 2, files of version 1 still import); request persistent storage with `navigator.storage.persist()` on the first save. AC: export/import round trip and old-file import covered by tests; invalid data is rejected without touching existing data.
- [x] **E04-02 Recipients** – Page `#/contacts` (list, search, edit, delete), "Save recipient" in the form, a picker that fills the recipient fields in all document types. AC: DE/EN, dark, narrow; field keys and validation stay as in `Workspace.tsx`.
- [x] **E04-03 Articles** – Manage articles (description, unit, net price, VAT rate) and pick them in `ItemsEditor`. AC: unit codes and VAT rate are valid for the e-invoice mapping; picking never overwrites an edited line without a click.
- [x] **E04-04 Seed from the archive** – "Import recipients and articles from issued documents" with de-duplication. AC: running it twice adds nothing new.
- [x] **E04-05 Docs and news** – README, `docs/10`, "Neuigkeiten", privacy policy states that master data stays in the browser. AC: `npm run build` green.
