# PDF Signatures

Two different things are called "signature". PDFCraft implements the first; the second is researched here and **not implemented**.

| | Signature image | Digital signature |
| --- | --- | --- |
| What it is | A picture of the handwritten signature printed on the page | A cryptographic seal inside the PDF (PAdES / PKCS#7) that proves who signed and that nothing changed afterwards |
| Status | Implemented | Not implemented |
| Needs | PNG, JPEG, SVG or PDF file | A signing certificate and its private key |

## 1. Signature image (implemented)

- Sender settings (**Sender & design › Signature**) take PNG, JPEG, SVG or PDF, at most 300 KB; API field `settings.signature.base64` (see [API Reference](09-api-reference.md)).
- Printed below the closing text of every document type, at most 15 mm high and 60 mm wide (letters: in the space between closing and sender name). The signature is part of the shared settings, so it is **not** stored in archive snapshots (like the logo); bulk ZIPs use the current signature.
- The file type is detected from its content, not from the file name. Invalid files give `400 validation_error` for `settings.signature`.
- **PDF input:** Typst refuses to embed PDFs when it exports PDF/A (`embedding PDFs is currently not supported in this export mode`), and PDFCraft exports PDF/A-3b for the e-invoice XML. The backend therefore converts the first page to SVG with `hayro-svg` (`backend/src/signature.rs`), then renders the SVG once to find the visible content and crops the `viewBox` to it, so a signature on a full A4 page is not shrunk to a speck. Parsing runs inside `catch_unwind`; the 300 KB limit bounds the work.
- Nothing is stored: like the logo, the file only lives in the request.

## 2. Digital signature: can the company's SSL/TLS certificate be used?

**Short answer: no, not in a useful way.** A PDF signature is just a CMS signature over the file bytes, so *technically* any key pair can produce one, but the result is not what you want:

1. **Wrong certificate profile.** TLS certificates (for example from Let's Encrypt or any domain-validated CA) are issued for `serverAuth` only (formerly also `clientAuth`) and carry `digitalSignature` (and `keyEncipherment`) but not `nonRepudiation`/`contentCommitment`. PDF viewers and validators check key usage and extended key usage for document signing.
2. **Not in the PDF trust lists.** Adobe Acrobat/Reader trusts certificates that chain to the Adobe Approved Trust List (AATL) or the EU Trusted List (EUTL, used by many readers for eIDAS). Domain-validation CAs are in neither list for document signing, so viewers show "signature validity unknown".
3. **It proves the wrong thing.** A domain-validated certificate says "the requester controlled the domain", not "this legal entity issued the invoice".
4. **Operational risk.** The TLS private key lives on the web server or in the cluster (cert-manager secret) and is rotated every ~60-90 days. Signatures would have to be timestamped (RFC 3161) and carry revocation data (PAdES-LT/LTA) to stay verifiable after expiry.

### Experiment (pyHanko 0.38.1, development environment)

A test CA signed two leaf certificates for the same PDF; the CA was configured as trusted:

| Certificate | Key usage / EKU | pyHanko result |
| --- | --- | --- |
| TLS-style (`CN=example.com`) | `digitalSignature, keyEncipherment` / `serverAuth` | signature intact, **rejected**: "key usage policy requires ... non repudiation" |
| Document signing (`O=Muster GmbH`) | `digitalSignature, nonRepudiation` / `emailProtection`, PDF signing OID `1.2.840.113583.1.1.5` | `INTACT:TRUSTED,UNTOUCHED` |

So even with a trusted issuer the TLS profile fails the default validation policy. Statements about Let's Encrypt profiles and the Adobe/EU trust lists above are from general knowledge (the CA and Adobe policy pages were not reachable from the development environment); check the current CA policy before relying on them.

## 3. What you would need instead

| Level | Certificate | Trust in viewers | Typical use |
| --- | --- | --- | --- |
| Self-signed / own CA | free | "unknown signer" (integrity only) | internal tests, closed circles that import your root |
| Document-signing certificate (OV, AATL) | from a trust service provider, key usually on an HSM or in a cloud-signing service | green check in Adobe | company "seal" on invoices and contracts |
| eIDAS advanced seal / qualified seal (EU) | qualified trust service provider, identity of the legal entity verified | trusted by EU validators; qualified = strongest evidential value | legally sensitive documents |
| Qualified electronic signature (QES) of a person | qualified provider, remote identification | equals a handwritten signature in the EU | contracts that legally require written form |

For invoices a signature is **not required** in Germany: since 2011 no qualified signature is needed, and from 2025 the e-invoice obligation is met by a structured format (XRechnung, ZUGFeRD/Factur-X), which PDFCraft already produces. A signature is a nice-to-have for authenticity and integrity, not a requirement.

## 4. How PDF signing works (PAdES)

1. Reserve a signature field with a `/Contents` placeholder and a `/ByteRange` that excludes only the placeholder.
2. Hash everything else (SHA-256) and build a detached CMS/PKCS#7 container (`ETSI.CAdES.detached` for PAdES) with the signer certificate and signed attributes, optionally with an RFC 3161 timestamp.
3. Write the container into the placeholder as an **incremental update**. The original bytes must stay untouched, otherwise the signature breaks. This keeps PDF/A-3b and the embedded Factur-X/XRechnung XML intact, so a signed ZUGFeRD PDF stays valid. Signing must therefore be the **last** step after `facturx::add_facturx_xmp`.
4. For long-term validity add revocation data and timestamps (PAdES-B-T / B-LT / B-LTA).

Typst (and the `typst-pdf` exporter) cannot create signatures; signing is a post-processing step on the finished PDF, in the same place as `backend/src/facturx.rs`.

## 5. Options if this is built later

| Option | Key held by | Fit |
| --- | --- | --- |
| **A. Customer signs locally** (Adobe, pyHanko, JSignPdf, a signature card) | customer | Works today with the downloaded PDF; nothing to build. |
| **B. Browser-side signing** (WebCrypto/PKCS#12 or a PKCS#11/WebUSB token, then incremental update in JS) | customer's browser | Fits the "no customer data on the server" principle; key never leaves the device. Most work in the frontend. |
| **C. Customer sends a PKCS#12 with the request** | request only | Same model as the Portokasse login: used in memory, never logged or stored. Simple for API users, but customers must be comfortable sending a private key and the certificate still has to be a proper document-signing one. |
| **D. Server-side seal with a PDFCraft key** | operator | Proves "issued by the operator", not by the customer. Not recommended for customer invoices. |
| **E. Remote signing service** (trust service provider with a signing API, including QES) | provider | The right way to get AATL/EUTL-trusted signatures without holding keys; adds a vendor, costs and an identification process per customer. |

Rust crates found on crates.io that implement PAdES signing (not evaluated; small user bases): `pdf_signer` (PKCS#12, PAdES B-B to B-LTA), `underskrift` (PAdES B-B to B-LTA), `pdf_signing`. `lopdf` (already a dependency) can write the incremental update but has no signing support.

**Recommendation:** keep the signature image for now (it covers the usual "signed letter/offer" look), tell users that a cryptographic signature needs a document-signing certificate, never a web-server certificate, and treat option C or B as the first implementation step if customers ask. Whatever is built must keep PDFs and keys out of persistent storage and must run after the Factur-X XMP step.
