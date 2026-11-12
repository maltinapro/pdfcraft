# E10 – PAdES signatures

**Phase:** 3 · **Depends on:** E00 (license decision), E01 · **Business plan:** sections 7 (Q3–Q4), 9 (risk 1) · **Status:** open

## Goal
Optional cryptographic PDF signing (PAdES) for customers who own a document-signing certificate. A digital signature is not required for e-invoices; this is an enterprise feature.

## Context / links
- Research and constraints: [15 PDF Signatures](../15-pdf-signatures.md) (TLS/domain certificates do not work; pyHanko experiment; image signature already implemented).
- `backend/src/facturx.rs` modifies the PDF after Typst export (XMP); `pdf_options()` exports PDF/A-3b. A signature must be the last step, because any later change breaks it.

## Definition of done
- A PDF can be signed (PAdES-B-B at least, with a timestamp as an option) with a customer certificate; the result opens as valid in the reference validators and stays PDF/A-3b and e-invoice-valid.

## Issues
- [ ] **E10-01 Design** – Choose PAdES level (B-B, B-T, B-LT), the signing flow after `facturx` post-processing (incremental update) and the key-handling model. AC: decision record covering PDF/A-3 compatibility and the effect on the e-invoice attachment.
- [ ] **E10-02 Library evaluation** – Compare Rust options (for example lopdf plus a CMS implementation, existing PDF signing crates) with calling an external signer. AC: prototype signs a PDF; result verified with pyHanko and the EU DSS validator; license compatible with MIT.
- [ ] **E10-03 Key-handling model** – Decide how keys reach the service without becoming customer data: self-hosted with a server-side key (file, PKCS#11/HSM, cloud KMS) vs. hosted with a request-scoped PKCS#12 and password that is never logged or stored. AC: threat model; for the hosted case a justification or a decision not to offer it.
- [ ] **E10-04 Backend signing step** – Optional `signing` configuration in the document request (or server config), applied after all other PDF steps; errors return stable codes (`signing_*`) with translations. AC: no key material in logs, `Debug` or metrics; unit and integration tests; metric `pdfcraft_signatures_total{result}`.
- [ ] **E10-05 Timestamp and long-term validation** – RFC 3161 timestamp authority setting, optional revocation data (OCSP/CRL) for PAdES-B-LT. AC: documented TSA configuration; offline/air-gapped behavior defined.
- [ ] **E10-06 Visible signature appearance (optional)** – Show the existing signature image or a seal text in a signature field. AC: placement does not collide with the DIN 5008 layout or the postage mark.
- [ ] **E10-07 Interplay checks** – Signed output passes Mustang and veraPDF (PDF/A-3b); the CI gate from E01-06 includes a signed sample. AC: CI job green.
- [ ] **E10-08 Frontend** – Only if hosted signing is offered: certificate upload with a clear warning about what is sent to the server; otherwise API/self-hosted only. AC: decision from E10-03 reflected; DE/EN.
- [ ] **E10-09 Plan gating and docs** – Apply the E00-05 decision (open core vs. commercial module, plan feature flag from E02). Update `docs/15-pdf-signatures.md`, API reference, README. AC: documented how to enable it.

## Open questions
- Is PAdES worth building before a paying customer asks for it (E13/E14 leads)?
