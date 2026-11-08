//! Start-up warm-up: compiles sample documents once so that fonts, package modules and the
//! constant parts of the templates are cached before the first real request.

use super::{invoice_data, INVOICE_TEMPLATE};
use crate::documents::{self, Document, Kind};
use crate::invoice::{check_invoice, check_settings, Errors, Invoice, Settings};
use crate::render_pdf;
use serde_json::json;

pub async fn warm_up() {
    for font in crate::invoice::FONTS {
        check_font(font).await;
    }
    sample_invoice(None).await;
    for kind in Kind::ALL {
        sample_document(kind).await;
    }
}

async fn sample_document(kind: Kind) {
    let raw_settings: Settings = serde_json::from_value(json!({
        "sender": {"name": "Warm-up", "address": "Street 1", "city": "12345 City"},
    }))
    .expect("valid warm-up settings");
    let raw_doc: Document = serde_json::from_value(json!({
        "number": "0", "date": "2026-01-01", "reference": "0", "subject": "Warm-up", "body": "Text",
        "recipient": {"name": "Warm-up", "address": "Street 2", "city": "12345 City"},
        "items": [{"description": "Item", "quantity": 1, "unit": "pcs", "price": 1, "taxRate": 19}],
    }))
    .expect("valid warm-up document");
    let mut errors = Errors::default();
    let settings = check_settings(&raw_settings, &mut errors);
    let doc = documents::check_document(kind, &raw_doc, false, &mut errors);
    if !errors.0.is_empty() {
        tracing::warn!(event = "warm_up_skipped", document = kind.slug(), errors = ?errors.0);
        return;
    }
    let (data, assets) = documents::build(kind, &raw_settings, settings.data, &raw_doc, doc, Vec::new());
    if let Err(e) = render_pdf(kind.template(), data, assets).await {
        tracing::warn!(event = "warm_up_failed", document = kind.slug(), error = ?e.details);
    }
}

/// Renders the sample invoice; `font` overrides `settings.font` and the PDF bytes are returned.
async fn sample_invoice(font: Option<&str>) -> Option<Vec<u8>> {
    let raw_settings: Settings = serde_json::from_value(json!({
        "font": font,
        "sender": {"name": "Warm-up", "address": "Street 1", "city": "12345 City"},
        "bank": {"name": "Bank", "iban": "DE89370400440532013000", "bic": "COBADEFFXXX"},
        "zugferd": true,
    }))
    .expect("valid warm-up settings");
    let raw_invoice: Invoice = serde_json::from_value(json!({
        "number": "0",
        "date": "2026-01-01",
        "recipient": {"name": "Warm-up", "address": "Street 2", "city": "12345 City"},
        "items": [{"description": "Item", "quantity": 1, "unit": "pcs", "price": 1, "taxRate": 19}],
    }))
    .expect("valid warm-up invoice");
    let mut errors = Errors::default();
    let settings = check_settings(&raw_settings, &mut errors);
    let invoice = check_invoice(&raw_invoice, "invoice", &mut errors);
    if !errors.0.is_empty() {
        tracing::warn!(event = "warm_up_skipped", errors = ?errors.0);
        return None;
    }
    let (data, assets) = invoice_data(&raw_settings, settings.data, &raw_invoice, invoice, Vec::new());
    let started = std::time::Instant::now();
    match render_pdf(INVOICE_TEMPLATE, data, assets).await {
        Ok(pdf) => {
            if font.is_none() {
                tracing::info!(event = "warm_up", duration_ms = started.elapsed().as_secs_f64() * 1000.0);
            }
            Some(pdf)
        }
        Err(e) => {
            tracing::warn!(event = "warm_up_failed", error = ?e.details);
            None
        }
    }
}

/// Typst silently falls back to another font when a family is not installed; warn at startup
/// if a selectable font does not end up embedded in the PDF.
async fn check_font(font: &str) {
    let Some(pdf) = sample_invoice(Some(font)).await else { return };
    // The PDF names the embedded font by its PostScript name (NewCM10-Regular for New Computer Modern).
    let needle = if font == "New Computer Modern" { "NewCM".to_string() } else { font.replace(' ', "") };
    if !pdf.windows(needle.len()).any(|w| w == needle.as_bytes()) {
        tracing::warn!(event = "font_missing", font, "selectable font is not installed; PDFs fall back to another font");
    }
}
