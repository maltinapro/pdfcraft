//! Stateless e-invoice reader behind `POST /v1/einvoices/parse`: a PDF (ZUGFeRD / Factur-X) or an XML file
//! (CII / UBL, XRechnung) in, the normalized view and the plausibility check out. It is the Rust port of the
//! browser viewer (`frontend/src/lib/einvoice/`) and gives the same results for the same file; shared golden
//! files (`frontend/src/lib/einvoice/testdata/expected/`) keep both sides identical. The uploaded file is only
//! held in memory while the request runs: nothing is stored or logged.

mod check;
mod extract;
mod view;
mod xml;

#[cfg(test)]
mod tests;

use axum::http::StatusCode;
use serde::Serialize;
use utoipa::ToSchema;

pub use check::{CheckResult, Lang};
pub use extract::{Source, MAX_PDF_BYTES};
pub use view::InvoiceView;

/// The view of an e-invoice and the result of the limited plausibility check.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ParseResponse {
    /// `pdf` when the XML was read from the attachment of a PDF, `xml` for an XML upload.
    pub source: Source,
    /// Name of the attachment the XML was read from (`pdf`) or `fileName` of the request (`xml`).
    pub file_name: String,
    /// The normalized view of the e-invoice.
    pub invoice: InvoiceView,
    /// Plausibility checks (mandatory fields, sums, dates, IBAN). This is NOT a validation against EN 16931 or
    /// the XRechnung rules.
    pub checks: Vec<CheckResult>,
    /// What the checks do not cover, in the requested language.
    pub not_checked: Vec<String>,
}

/// Why a file could not be read; the codes are stable and part of the API.
#[derive(Debug, PartialEq, Eq)]
pub struct ParseFailure {
    pub status: StatusCode,
    pub code: &'static str,
    pub details: String,
}

impl Lang {
    /// `de` or `en` (case-insensitive); anything else is not supported.
    pub fn from_code(code: &str) -> Option<Self> {
        match code.to_ascii_lowercase().as_str() {
            "de" => Some(Lang::De),
            "en" => Some(Lang::En),
            _ => None,
        }
    }
}

fn failure(status: StatusCode, code: &'static str, details: impl Into<String>) -> ParseFailure {
    ParseFailure {
        status,
        code,
        details: details.into(),
    }
}

/// Reads an uploaded file (PDF with XML attachment, or XML) and returns its view and plausibility checks.
/// CPU-bound: call it from `spawn_blocking`.
pub fn parse_upload(
    bytes: &[u8],
    file_name: &str,
    lang: Lang,
) -> Result<ParseResponse, ParseFailure> {
    let extracted = extract::extract(bytes, file_name).map_err(|e| match e.code {
        "empty" => failure(StatusCode::BAD_REQUEST, "invalid_request", e.message),
        "too_large" => failure(StatusCode::PAYLOAD_TOO_LARGE, "invalid_request", e.message),
        "unsupported" => failure(StatusCode::BAD_REQUEST, "unsupported_file", e.message),
        "pdf_encrypted" => failure(StatusCode::BAD_REQUEST, "pdf_encrypted", e.message),
        "no_xml" => failure(StatusCode::BAD_REQUEST, "no_xml_attachment", e.message),
        _ => failure(StatusCode::BAD_REQUEST, "pdf_unreadable", e.message),
    })?;
    let invoice = view::parse_einvoice(&extracted.xml).map_err(|e| match e {
        view::ParseError::InvalidXml(message) => {
            failure(StatusCode::BAD_REQUEST, "invalid_xml", message)
        }
        view::ParseError::UnsupportedRoot(root) => failure(
            StatusCode::BAD_REQUEST,
            "unsupported_einvoice",
            format!("unsupported XML root element <{root}> (expected CrossIndustryInvoice, Invoice or CreditNote)"),
        ),
        view::ParseError::Zugferd1 => failure(
            StatusCode::BAD_REQUEST,
            "unsupported_einvoice",
            "ZUGFeRD 1.x (CrossIndustryDocument) is not supported",
        ),
    })?;
    let checks = check::run_checks(&invoice, lang);
    Ok(ParseResponse {
        source: extracted.source,
        file_name: extracted.file_name,
        invoice,
        checks,
        not_checked: check::not_checked(lang),
    })
}
