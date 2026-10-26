# AGENTS.md

## Project
PDFCraft is a full-stack PDF template builder:
- Frontend: React + Vite + Tiptap
- Backend: Rust + Axum
- Templating: minijinja
- PDF generation path (current backend): Typst via `typst-as-lib`

## Repository Structure
- `frontend/` — UI editor and template serialization
- `backend/` — API server (`/generate-pdf`, `/health`)
- `README.md` — product overview and setup

## Local Development
### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
cargo run
```

## Validation Commands
Backend checks used in this project:
```bash
cd backend
cargo check
```

Frontend checks used in this project:
```bash
cd frontend
npm run build
```

## Backend PDF Pipeline (Current)
1. Receive `{ template, data }` in `POST /generate-pdf`
2. Render template with minijinja (`template` + `data`)
3. Compile rendered Typst content to document using `typst-as-lib` + Typst
4. Convert document to PDF bytes with `typst-pdf`
5. Return PDF with content headers

## Recent Changes Applied
- Replaced old Tectonic/LaTeX compilation path in backend handler with Typst-based flow.
- Updated backend dependencies to Typst ecosystem:
  - `typst = "0.15.1"`
  - `typst-pdf = "0.15.1"`
  - `typst-as-lib = "0.17.0"`
- Confirmed build health with `cargo check`.
- Migrated frontend template serializer from LaTeX output to Typst output.
  - Renamed serializer file from `frontend/src/lib/tiptapToLatex.ts` to `frontend/src/lib/tiptapToTypst.ts`
  - Renamed exported function to `tiptapToTypst`
  - Updated `frontend/src/App.tsx` imports and calls to use the Typst serializer
  - Updated UI labels from LaTeX preview/builder wording to Typst wording
- Confirmed frontend build health with `npm run build`.
- Refreshed `README.md` to consistently document the Typst-based pipeline.
  - Replaced remaining LaTeX/Tectonic references in flow descriptions and API docs
  - Updated serializer and extension guidance to `tiptapToTypst`
  - Updated examples and tech stack wording to match current implementation
- Performed a migration audit for Typst alignment across backend and frontend.
  - Verified backend compile path uses `typst-as-lib` + `typst-pdf` and no active LaTeX/Tectonic pipeline
  - Verified frontend uses `tiptapToTypst` serializer and Typst preview/generation flow
  - Confirmed project health with `cd backend && cargo check` and `cd frontend && npm run build`
  - Collected version update signals (`npm outdated`, `cargo search`) for future dependency planning
- Hardened backend request handling and error responses.
  - Added request body limit via `DefaultBodyLimit::max(512 * 1024)`
  - Added structured JSON error responses with explicit error codes/details
  - Mapped invalid payload/template/render errors to client-oriented status codes
- Improved frontend runtime configuration and naming consistency.
  - Kept PDF API base URL configurable via `VITE_API_BASE_URL` with localhost fallback
  - Added `frontend/src/vite-env.d.ts` for `import.meta.env` typing
  - Renamed remaining preview classes from `latex-*` to `typst-*` in `App.tsx` and `App.css`
- Re-validated project health after the above updates.
  - Confirmed backend with `cd backend && cargo check`
  - Confirmed frontend with `cd frontend && npm run build`

## Notes for Next Work
- Frontend serializer and backend template language should stay aligned.
- Extend Typst serializer coverage if additional Tiptap nodes or advanced layout features are introduced.
- Keep `cargo check` green after any backend change.
- Keep `npm run build` green after any frontend change.

