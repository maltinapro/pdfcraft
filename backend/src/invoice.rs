//! Input model and validation for `/v1/invoices`.
//!
//! Accepts the same JSON as the app's config export (`settings` + `invoice`),
//! validates it strictly (whitelisted values, length limits) and escapes all
//! text so it can be placed into Typst string literals. This is the only
//! validation layer: the frontend sends its raw form values.

use serde::Deserialize;
use serde_json::{json, Value as JsonValue};

const FONTS: &[&str] = &[
    "Liberation Sans",
    "Liberation Serif",
    "Libertinus Serif",
    "New Computer Modern",
    "DejaVu Sans Mono",
];
const LOCALES: &[&str] = &["de-de", "en-de"];
const UNITS: &[&str] = &[
    "pcs", "h", "d", "mo", "y", "flat", "kg", "m", "km", "m2", "l",
];
const PROFILES: &[&str] = &["en16931", "xrechnung"];
const TAX_RATES: &[i64] = &[19, 7, 0];

const MAX_NUMBER: f64 = 1e9;
const MAX_ITEMS: usize = 500;
const MAX_SHORT: usize = 200;
const MAX_LONG: usize = 2000;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Sender {
    pub name: String,
    pub address: String,
    pub city: String,
    pub tax_nr: String,
    pub vat_id: String,
    pub email: String,
    pub phone: String,
    pub contact_name: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Bank {
    pub name: String,
    pub iban: String,
    pub bic: String,
}

#[derive(Deserialize)]
pub struct Logo {
    base64: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub logo: Option<Logo>,
    pub sender: Sender,
    pub accent_color: Option<String>,
    pub font: Option<String>,
    pub locale: Option<String>,
    pub footer: String,
    pub intro: String,
    pub closing: String,
    pub payment_days: Option<f64>,
    pub exemption_reason: Option<String>,
    pub bank: Bank,
    pub zugferd: Option<bool>,
    pub einvoice_profile: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Recipient {
    pub name: String,
    pub address: String,
    pub city: String,
    pub vat_id: String,
    pub email: String,
    pub buyer_reference: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Item {
    pub description: String,
    pub quantity: f64,
    pub unit: Option<String>,
    pub price: f64,
    pub tax_rate: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Invoice {
    pub number: String,
    pub date: String,
    pub recipient: Recipient,
    pub items: Vec<Item>,
}

/// Collects all validation problems so the client sees them at once.
#[derive(Default)]
pub struct Errors(pub Vec<String>);

impl Errors {
    fn add(&mut self, path: &str, msg: &str) {
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

fn text(e: &mut Errors, path: &str, value: &str, max: usize, required: bool) -> String {
    let value = value.trim();
    if required && value.is_empty() {
        e.add(path, "is required");
    }
    if value.chars().count() > max {
        e.add(path, &format!("must be at most {max} characters"));
    }
    escape(value)
}

fn one_of(e: &mut Errors, path: &str, value: Option<&String>, allowed: &[&str], default: &str) -> String {
    match value {
        None => default.to_string(),
        Some(v) if allowed.contains(&v.as_str()) => v.clone(),
        Some(_) => {
            e.add(path, &format!("must be one of: {}", allowed.join(", ")));
            default.to_string()
        }
    }
}

fn number(e: &mut Errors, path: &str, value: f64) -> f64 {
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

/// Validated settings: the template data plus the optional logo (base64).
pub struct CheckedSettings {
    pub data: JsonValue,
    pub logo: Option<String>,
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
    json!({
        "number": text(e, &format!("{path}.number"), &inv.number, MAX_SHORT, true),
        "date": { "year": date.0, "month": date.1, "day": date.2 },
        "recipient": recipient,
        "items": items,
    })
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
