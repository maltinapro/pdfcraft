# Epics

The code changes derived from the business plan ("Businessplan PDFCraft", digitalrechnung.jetzt) are split into epics. Each epic is one file `EXX-name.md` with goal, dependencies, definition of done and issues. The overall order is in the [roadmap](../roadmap.md). An epic exists only for work that is code and worth doing now; everything else is listed in the roadmap with the trigger that would justify it.

## Conventions

- Issue IDs: `EXX-NN` (for example `E02-03`). Status by checkbox: `- [ ]` open, `- [x]` done.
- Every issue has a short description and acceptance criteria (AC).
- One PR per issue when the change is large or reviews better that way, otherwise a coherent group of small issues of one epic; branched from the latest `main`. The PR description lists `Closes #<n>` for every sub-issue it solves (and for the epic when it completes it), so the issues are closed on merge; PR titles follow Conventional Commits (`feat: ...`, `docs: ...`).
- When an issue is finished: tick the checkbox, update the status in [roadmap.md](../roadmap.md), the affected docs, `README.md` and `AGENTS.md`.
- Epics may be adjusted; name the reason in the PR.

## Cross-cutting requirements (apply to every issue)

- **Tests** for new behavior; `cd backend && cargo check` and `cd frontend && npm run build` stay green.
- **Docs**: update `README.md` (short) and the affected guide in `docs/` in the same PR.
- **No customer data retention**: no caches of rendered templates or PDFs, nothing customer-specific persisted on the server (only hashed tokens/counters in Valkey).
- **Visual verification** after every PDF or frontend change (screenshots in DE/EN, light/dark, narrow width; PDF rasterized and looked at).
- **Frontend text** via `tr(de, en)`; new backend validation messages/codes get a translation in `frontend/src/lib/apiErrors.ts`.
- **Template, serializer and validation stay aligned**: `invoice.rs`, `einvoice.rs`, `validate.ts`, the Typst templates.
- **Observability**: new metrics are added to `deploy/helm/pdfcraft/dashboards/` and `docs/13-observability.md`.
- **Local trial**: every new feature or external dependency is runnable with `docker compose` (mock in profile `mock` where needed) and documented.
- **User-visible changes** get a short entry in the "Neuigkeiten" section of `frontend/index.html`.

## GitHub issues

- The Markdown files are the source of truth for scope and acceptance criteria; GitHub issues are used for tracking.
- One issue per epic (label `epic`), one sub-issue per task (label `task`), plus the phase label `phase-1` … `phase-3`.
- Issues are created **phase by phase**; the current state is tracked in [../roadmap.md](../roadmap.md). The issue title is `EXX-NN Title`; the body is the issue description plus acceptance criteria from the file.

## Template

```markdown
# EXX – Title

**Phase:** … · **Depends on:** … · **Status:** open

## Goal
## Context / links
## Definition of done
## Issues
- [ ] **EXX-01 Title** – Description. AC: …
## Open questions
```

## Overview

See [../roadmap.md](../roadmap.md).
