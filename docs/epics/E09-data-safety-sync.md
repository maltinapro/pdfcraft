# E09 – Data safety and optional sync

**Phase:** 2 · **Depends on:** E07 · **Business plan:** section 9 (risk 2) · **Status:** open

## Goal
Reduce the risk that users lose their data when the browser storage is cleared. The "Daten & Sicherung" page and the dashboard reminder already exist; this epic adds automatic backups to a local folder, encrypted backups and evaluates an optional end-to-end encrypted sync as a premium feature.

## Context / links
- `frontend/src/lib/backup.ts`, `components/DataPage.tsx`, `components/BackupBanner.tsx`, `lib/archive.ts`, `lib/storage.ts`; backup file `pdfcraft-backup-<date>.json`.
- Promise on the site: no customer data on the server. A cloud sync would change that (ciphertext only) and needs a deliberate decision.

## Definition of done
- Backups cover all local data (settings, drafts, archive, master data, logo/signature) and can be restored; automatic folder backup works where the browser supports it; sync is either implemented with a clear privacy model or consciously dropped.

## Issues
- [ ] **E09-01 Backup coverage review** – Check what the backup contains versus all `pdfcraft.*` keys (including master data from E07, free/paid token handling, language/theme) and fix gaps; add a restore test. AC: documented list of included and excluded keys; tokens are excluded or explicitly opt-in.
- [ ] **E09-02 Persistent storage** – Request `navigator.storage.persist()`, detect and warn about browsers that evict storage (for example Safari's inactivity eviction), show the state on the data page. AC: DE/EN texts; behavior verified in Chromium and Firefox.
- [ ] **E09-03 Folder backup (File System Access API)** – Let the user choose a folder once (handle kept in IndexedDB) and write the backup automatically after changes/downloads. AC: Chromium only with a clean fallback to the download flow; permission loss handled; no silent data overwrite (rolling file names or versions).
- [ ] **E09-04 Backup reminders** – Make the reminder logic aware of the folder backup (no nagging when it is current) and of the amount of unsaved data. AC: unit tests for the reminder rules.
- [ ] **E09-05 Encrypted backups** – Optional password protection of the backup file in the browser (WebCrypto, key derivation with a strong KDF, authenticated encryption), documented format with version field. AC: wrong password gives a clear error; round-trip test; a lost password cannot be recovered and the UI says so.
- [ ] **E09-06 Spike: E2E-encrypted sync (premium)** – Evaluate architecture (blob store, key handling, device pairing, conflict resolution), storage cost, GDPR position of encrypted data, effect on the "stateless" positioning and on E00-03/E00-04 plan scope. AC: decision record: build, defer or drop.
- [ ] **E09-07 Implement sync (only if E09-06 says build)** – Client-side encryption, server stores ciphertext and a token-bound namespace only; export/delete-all control for the user. AC: threat model documented; privacy policy and terms updated; no plaintext and no keys on the server.
- [ ] **E09-08 Docs and news** – Update the data page texts, README, docs, "Neuigkeiten". AC: backup/restore described step by step.

## Open questions
- Is the folder backup enough for the target group, making a paid sync unnecessary?
