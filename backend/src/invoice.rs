//! Input model and validation for `/v1/invoices`.
//!
//! Accepts the same JSON as the app's config export (`settings` + `invoice`),
//! validates it strictly (whitelisted values, length limits) and escapes all
//! text so it can be placed into Typst string literals. This is the only
//! validation layer: the frontend sends its raw form values.

use crate::postage::{self, Postage};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use utoipa::ToSchema;

pub const FONTS: &[&str] = &[
    "Liberation Sans",
    "Carlito",
    "Open Sans",
    "Roboto",
    "Lato",
    "DejaVu Sans",
    "Liberation Serif",
    "Libertinus Serif",
    "New Computer Modern",
    "DejaVu Sans Mono",
];
pub(crate) const LOCALES: &[&str] = &["de-de", "en-de"];
pub(crate) const UNITS: &[&str] = &[
    "pcs", "h", "d", "mo", "y", "flat", "kg", "m", "km", "m2", "l",
];
pub(crate) const PROFILES: &[&str] = &["en16931", "xrechnung"];
pub(crate) const TAX_RATES: &[i64] = &[19, 7, 0];

const MAX_NUMBER: f64 = 1e9;
pub(crate) const MAX_ITEMS: usize = 500;
pub(crate) const MAX_SHORT: usize = 200;
pub(crate) const MAX_LONG: usize = 2000;

/// Plain text of at most 200 characters; do not escape it, the server does.
#[derive(Deserialize, Serialize, Default, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct Sender {
    #[schema(required = true, max_length = 200)]
    pub name: String,
    #[schema(required = true, max_length = 200)]
    pub address: String,
    #[schema(required = true, max_length = 200)]
    pub city: String,
    #[schema(max_length = 200)]
    pub tax_nr: String,
    #[schema(max_length = 200)]
    pub vat_id: String,
    #[schema(max_length = 200)]
    pub email: String,
    #[schema(max_length = 200)]
    pub phone: String,
    #[schema(max_length = 200)]
    pub contact_name: String,
}

#[derive(Deserialize, Serialize, Default, ToSchema)]
#[serde(default)]
pub struct Bank {
    #[schema(max_length = 200)]
    pub name: String,
    #[schema(max_length = 200)]
    pub iban: String,
    #[schema(max_length = 200)]
    pub bic: String,
}

/// An uploaded file (logo or signature), base64 encoded.
#[derive(Deserialize, Serialize, ToSchema)]
#[schema(as = Image)]
pub struct Logo {
    /// The file, base64 encoded (at most 1 MB decoded for a logo, 300 KB for a signature).
    #[schema(required = true)]
    base64: String,
}

/// Sender and design, shared by all documents of a request. This is the structure the configurator
/// exports; unknown fields (for example `schemaVersion`) are ignored.
#[derive(Deserialize, Serialize, Default, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Logo printed in the letterhead (PNG, JPEG or SVG).
    pub logo: Option<Logo>,
    /// Handwritten signature printed below the closing text: PNG, JPEG, SVG or PDF (detected by content,
    /// at most 300 KB decoded). It is an image, not a cryptographic signature.
    pub signature: Option<Logo>,
    #[schema(required = true)]
    pub sender: Sender,
    /// Color as `#rrggbb`.
    #[schema(default = "#1d4ed8", pattern = "^#[0-9a-fA-F]{6}$")]
    pub accent_color: Option<String>,
    /// One of the fonts offered by the configurator.
    #[schema(default = "Liberation Sans")]
    pub font: Option<String>,
    /// Language of the document texts.
    #[schema(default = "de-de")]
    pub locale: Option<String>,
    #[schema(max_length = 2000)]
    pub footer: String,
    /// Text above the items.
    #[schema(max_length = 2000)]
    pub intro: String,
    /// Text below the totals.
    #[schema(max_length = 2000)]
    pub closing: String,
    /// Payment term in days (whole number from 0 to 365).
    #[schema(value_type = Option<i64>, default = 14, minimum = 0, maximum = 365)]
    pub payment_days: Option<f64>,
    /// Reason printed and sent in the e-invoice for items with a tax rate of 0 %.
    #[schema(default = "Steuerfrei nach § 4 UStG", max_length = 200)]
    pub exemption_reason: Option<String>,
    pub bank: Bank,
    /// Attach the e-invoice XML to the PDF.
    #[schema(default = true)]
    pub zugferd: Option<bool>,
    /// `en16931` attaches `factur-x.xml` (ZUGFeRD / Factur-X), `xrechnung` attaches `xrechnung.xml`.
    #[schema(default = "en16931")]
    pub einvoice_profile: Option<String>,
}

#[derive(Deserialize, Serialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct Recipient {
    #[schema(required = true, max_length = 200)]
    pub name: String,
    #[schema(required = true, max_length = 200)]
    pub address: String,
    #[schema(required = true, max_length = 200)]
    pub city: String,
    /// Used for credit notes and invoices (e-invoice).
    #[schema(max_length = 200)]
    pub vat_id: String,
    /// Used for credit notes and invoices (e-invoice).
    #[schema(max_length = 200)]
    pub email: String,
    /// Buyer reference (Leitweg-ID for public customers); required by XRechnung.
    #[schema(max_length = 200)]
    pub buyer_reference: String,
}

#[derive(Deserialize, Serialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct Item {
    #[schema(required = true, max_length = 2000)]
    pub description: String,
    /// Quantity (between -1e9 and 1e9).
    #[schema(required = true, minimum = -1e9, maximum = 1e9)]
    pub quantity: f64,
    /// Unit of the quantity: pieces, hour, day, month, year, flat rate, kg, m, km, m², litre.
    #[schema(default = "pcs")]
    pub unit: Option<String>,
    /// Net unit price in euro (between -1e9 and 1e9).
    #[schema(required = true, minimum = -1e9, maximum = 1e9)]
    pub price: f64,
    /// Tax rate in percent.
    #[schema(value_type = Option<i64>, default = 19)]
    pub tax_rate: Option<f64>,
}

#[derive(Deserialize, Serialize, Default, ToSchema)]
#[serde(default)]
pub struct Invoice {
    #[schema(required = true, max_length = 200)]
    pub number: String,
    /// Invoice date as `YYYY-MM-DD` (years 1970 to 2200).
    #[schema(required = true, format = Date)]
    pub date: String,
    #[schema(required = true)]
    pub recipient: Recipient,
    #[schema(required = true, min_items = 1, max_items = 500)]
    pub items: Vec<Item>,
    /// Franking mark (Internetmarke PNG) printed into the address field.
    pub postage: Option<Postage>,
}

/// Collects all validation problems so the client sees them at once.
#[derive(Default)]
pub struct Errors(pub Vec<String>);

impl Errors {
    pub(crate) fn add(&mut self, path: &str, msg: &str) {
        self.0.push(format!("{path}: {msg}"));
    }
}

/// Only `\` and `"` need escaping inside a Typst string literal; line breaks are kept.
pub fn escape(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .filter(|c| !matches!(*c, '\u{0}'..='\u{9}' | '\u{b}'..='\u{1f}' | '\u{7f}'))
        .collect::<String>()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

pub(crate) fn text(e: &mut Errors, path: &str, value: &str, max: usize, required: bool) -> String {
    let value = value.trim();
    if required && value.is_empty() {
        e.add(path, "is required");
    }
    if value.chars().count() > max {
        e.add(path, &format!("must be at most {max} characters"));
    }
    escape(value)
}

pub(crate) fn one_of(e: &mut Errors, path: &str, value: Option<&String>, allowed: &[&str], default: &str) -> String {
    match value {
        None => default.to_string(),
        Some(v) if allowed.contains(&v.as_str()) => v.clone(),
        Some(_) => {
            e.add(path, &format!("must be one of: {}", allowed.join(", ")));
            default.to_string()
        }
    }
}

pub(crate) fn number(e: &mut Errors, path: &str, value: f64) -> f64 {
    if !value.is_finite() || value.abs() > MAX_NUMBER {
        e.add(path, "must be a number between -1e9 and 1e9");
        return 0.0;
    }
    value
}

pub fn valid_date(iso: &str) -> Option<(i32, u32, u32)> {
    let mut parts = iso.split('-');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    let (y, m, d): (i32, u32, u32) = (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?);
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    ((1970..=2200).contains(&y) && (1..=days).contains(&d)).then_some((y, m, d))
}

/// Validated settings: the template data plus the optional logo and signature (base64).
pub struct CheckedSettings {
    pub data: JsonValue,
    pub logo: Option<String>,
    pub signature: Option<String>,
}

const MAX_SIGNATURE_BYTES: usize = 300 * 1024;

/// What the signature file is, judged by its content (never by the client's file name).
fn signature_kind(bytes: &[u8]) -> Option<&'static str> {
    let head = &bytes[..bytes.len().min(2048)];
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("PNG")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("JPEG")
    } else if head.starts_with(b"%PDF-") {
        Some("PDF")
    } else if String::from_utf8_lossy(head).contains("<svg") {
        Some("SVG")
    } else {
        None
    }
}

/// The signature is an image (PNG, JPEG, SVG) or a PDF; returns it as base64 for the template.
/// A PDF becomes an SVG of its first page because Typst cannot embed PDFs in PDF/A exports.
fn check_signature(sig: Option<&Logo>, e: &mut Errors) -> Option<String> {
    let encoded = sig?.base64.trim();
    let bytes = match BASE64.decode(encoded) {
        Ok(b) => b,
        Err(_) => {
            e.add("settings.signature", "must be valid base64");
            return None;
        }
    };
    if bytes.len() > MAX_SIGNATURE_BYTES {
        e.add("settings.signature", "must not exceed 300 KB");
        return None;
    }
    match signature_kind(&bytes) {
        None => {
            e.add("settings.signature", "must be a PNG, JPEG, SVG or PDF file");
            None
        }
        Some("PDF") => match crate::signature::pdf_to_svg(&bytes) {
            Some(svg) => Some(BASE64.encode(svg)),
            None => {
                e.add("settings.signature", "the PDF could not be read");
                None
            }
        },
        Some(_) => Some(encoded.to_string()),
    }
}

pub fn check_settings(s: &Settings, e: &mut Errors) -> CheckedSettings {
    let accent = match s.accent_color.as_deref() {
        None => "#1d4ed8".to_string(),
        Some(c)
            if c.len() == 7
                && c.starts_with('#')
                && c[1..].chars().all(|ch| ch.is_ascii_hexdigit()) =>
        {
            c.to_string()
        }
        Some(_) => {
            e.add("settings.accentColor", "must look like #1d4ed8");
            "#1d4ed8".to_string()
        }
    };
    let payment_days = match s.payment_days {
        None => 14,
        Some(d) if d.fract() == 0.0 && (0.0..=365.0).contains(&d) => d as i64,
        Some(_) => {
            e.add("settings.paymentDays", "must be a whole number between 0 and 365");
            14
        }
    };
    let sender = &s.sender;
    let bank = &s.bank;
    let data = json!({
        "accentColor": accent,
        "font": one_of(e, "settings.font", s.font.as_ref(), FONTS, FONTS[0]),
        "locale": one_of(e, "settings.locale", s.locale.as_ref(), LOCALES, LOCALES[0]),
        "zugferd": s.zugferd.unwrap_or(true),
        "einvoiceProfile": one_of(e, "settings.einvoiceProfile", s.einvoice_profile.as_ref(), PROFILES, PROFILES[0]),
        "footer": text(e, "settings.footer", &s.footer, MAX_LONG, false),
        "intro": text(e, "settings.intro", &s.intro, MAX_LONG, false),
        "closing": text(e, "settings.closing", &s.closing, MAX_LONG, false),
        "exemptionReason": text(
            e,
            "settings.exemptionReason",
            s.exemption_reason.as_deref().unwrap_or("Steuerfrei nach § 4 UStG"),
            MAX_SHORT,
            false,
        ),
        "paymentDays": payment_days,
        "sender": {
            "name": text(e, "settings.sender.name", &sender.name, MAX_SHORT, true),
            "address": text(e, "settings.sender.address", &sender.address, MAX_SHORT, true),
            "city": text(e, "settings.sender.city", &sender.city, MAX_SHORT, true),
            "taxNr": text(e, "settings.sender.taxNr", &sender.tax_nr, MAX_SHORT, false),
            "vatId": text(e, "settings.sender.vatId", &sender.vat_id, MAX_SHORT, false),
            "email": text(e, "settings.sender.email", &sender.email, MAX_SHORT, false),
            "phone": text(e, "settings.sender.phone", &sender.phone, MAX_SHORT, false),
            "contactName": text(e, "settings.sender.contactName", &sender.contact_name, MAX_SHORT, false),
        },
        "bank": {
            "name": text(e, "settings.bank.name", &bank.name, MAX_SHORT, false),
            "iban": text(e, "settings.bank.iban", &bank.iban, MAX_SHORT, false),
            "bic": text(e, "settings.bank.bic", &bank.bic, MAX_SHORT, false),
        },
    });
    CheckedSettings {
        data,
        logo: s.logo.as_ref().map(|l| l.base64.clone()),
        signature: check_signature(s.signature.as_ref(), e),
    }
}

pub fn check_invoice(inv: &Invoice, path: &str, e: &mut Errors) -> JsonValue {
    let date = match valid_date(&inv.date) {
        Some(d) => d,
        None => {
            e.add(&format!("{path}.date"), "must be a valid date as YYYY-MM-DD");
            (1970, 1, 1)
        }
    };
    if inv.items.is_empty() || inv.items.len() > MAX_ITEMS {
        e.add(&format!("{path}.items"), &format!("needs 1 to {MAX_ITEMS} items"));
    }
    let r = &inv.recipient;
    let rp = format!("{path}.recipient");
    let recipient = json!({
        "name": text(e, &format!("{rp}.name"), &r.name, MAX_SHORT, true),
        "address": text(e, &format!("{rp}.address"), &r.address, MAX_SHORT, true),
        "city": text(e, &format!("{rp}.city"), &r.city, MAX_SHORT, true),
        "vatId": text(e, &format!("{rp}.vatId"), &r.vat_id, MAX_SHORT, false),
        "email": text(e, &format!("{rp}.email"), &r.email, MAX_SHORT, false),
        "buyerReference": text(e, &format!("{rp}.buyerReference"), &r.buyer_reference, MAX_SHORT, false),
    });
    let items: Vec<JsonValue> = inv
        .items
        .iter()
        .take(MAX_ITEMS)
        .enumerate()
        .map(|(i, item)| {
            let ip = format!("{path}.items[{i}]");
            let tax_rate = match item.tax_rate {
                None => 19,
                Some(t) if t.fract() == 0.0 && TAX_RATES.contains(&(t as i64)) => t as i64,
                Some(_) => {
                    e.add(&format!("{ip}.taxRate"), "must be one of: 19, 7, 0");
                    19
                }
            };
            json!({
                "description": text(e, &format!("{ip}.description"), &item.description, MAX_LONG, true),
                "price": number(e, &format!("{ip}.price"), item.price),
                "quantity": number(e, &format!("{ip}.quantity"), item.quantity),
                "unit": one_of(e, &format!("{ip}.unit"), item.unit.as_ref(), UNITS, "pcs"),
                "taxRate": tax_rate,
            })
        })
        .collect();
    let mut out = json!({
        "number": text(e, &format!("{path}.number"), &inv.number, MAX_SHORT, true),
        "date": { "year": date.0, "month": date.1, "day": date.2 },
        "recipient": recipient,
        "items": items,
    });
    if let Some(stamp) = postage::check_optional(inv.postage.as_ref(), path, e) {
        out["postage"] = stamp.data();
    }
    out
}

/// File name stem for an invoice number: letters, digits, `.`, `_` and `-` only.
pub fn file_stem(number: &str) -> String {
    let stem: String = number
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' })
        .take(80)
        .collect();
    if stem.is_empty() { "invoice".into() } else { stem }
}
