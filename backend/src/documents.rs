//! Non-invoice documents for `/v1/documents`: credit note (Stornorechnung), offer, order
//! confirmation, delivery note and letter.
//!
//! Same rules as `invoice.rs`: strict validation, whitelisted values, all text escaped for Typst
//! string literals. Each type has its own template (`frontend/src/template/<type>.typ`) that is
//! appended to the shared `document-common.typ`. No e-invoice XML is produced for these types.

use crate::einvoice::{self, describe_items, german_date};
use crate::invoice::{
    number, one_of, text, valid_date, Errors, Invoice, Item, Recipient, Settings, MAX_ITEMS, MAX_LONG, MAX_SHORT, TAX_RATES,
    UNITS,
};
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};

const MAX_BODY: usize = 10_000;

const COMMON: &str = include_str!("../../frontend/src/template/document-common.typ");

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    CreditNote,
    Offer,
    Order,
    DeliveryNote,
    Letter,
}

impl Kind {
    pub const ALL: [Kind; 5] = [Kind::CreditNote, Kind::Offer, Kind::Order, Kind::DeliveryNote, Kind::Letter];

    pub fn parse(value: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.slug() == value)
    }

    pub fn slug(self) -> &'static str {
        match self {
            Kind::CreditNote => "credit-note",
            Kind::Offer => "offer",
            Kind::Order => "order",
            Kind::DeliveryNote => "delivery-note",
            Kind::Letter => "letter",
        }
    }

    fn body(self) -> &'static str {
        match self {
            Kind::CreditNote => include_str!("../../frontend/src/template/credit-note.typ"),
            Kind::Offer => include_str!("../../frontend/src/template/offer.typ"),
            Kind::Order => include_str!("../../frontend/src/template/order.typ"),
            Kind::DeliveryNote => include_str!("../../frontend/src/template/delivery-note.typ"),
            Kind::Letter => include_str!("../../frontend/src/template/letter.typ"),
        }
    }

    /// Complete Typst source: shared preamble plus the type's own layout.
    pub fn template(self) -> String {
        format!("{COMMON}\n{}", self.body())
    }

    fn has_items(self) -> bool {
        self != Kind::Letter
    }

    fn has_number(self) -> bool {
        self != Kind::Letter
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Document {
    pub number: String,
    pub date: String,
    pub recipient: Recipient,
    pub items: Vec<Item>,
    /// Original invoice (credit note), offer (order) or order number (delivery note).
    pub reference: String,
    pub reference_date: String,
    pub valid_until: String,
    pub delivery_date: String,
    pub subject: String,
    pub body: String,
    pub reason: String,
    pub intro: String,
    pub closing: String,
}

fn optional_date(e: &mut Errors, path: &str, iso: &str) -> Option<String> {
    let iso = iso.trim();
    if iso.is_empty() {
        return None;
    }
    match valid_date(iso) {
        Some(d) => Some(german_date(d)),
        None => {
            e.add(path, "must be a valid date as YYYY-MM-DD");
            None
        }
    }
}

/// Validated template data of a document (`doc`), display texts included.
pub fn check_document(kind: Kind, doc: &Document, english: bool, e: &mut Errors) -> JsonValue {
    let date = match valid_date(&doc.date) {
        Some(d) => d,
        None => {
            e.add("document.date", "must be a valid date as YYYY-MM-DD");
            (1970, 1, 1)
        }
    };
    let r = &doc.recipient;
    let mut out = json!({
        "kind": kind.slug(),
        "number": text(e, "document.number", &doc.number, MAX_SHORT, kind.has_number()),
        "year": date.0,
        "month": date.1,
        "day": date.2,
        "dateText": german_date(date),
        "recipient": {
            "name": text(e, "document.recipient.name", &r.name, MAX_SHORT, true),
            "address": text(e, "document.recipient.address", &r.address, MAX_SHORT, true),
            "city": text(e, "document.recipient.city", &r.city, MAX_SHORT, true),
        },
        "reference": text(e, "document.reference", &doc.reference, MAX_SHORT, kind == Kind::CreditNote),
        "referenceDateText": optional_date(e, "document.referenceDate", &doc.reference_date),
        "validUntilText": optional_date(e, "document.validUntil", &doc.valid_until),
        "deliveryDateText": optional_date(e, "document.deliveryDate", &doc.delivery_date),
        "subject": text(e, "document.subject", &doc.subject, MAX_SHORT, kind == Kind::Letter),
        "body": text(e, "document.body", &doc.body, MAX_BODY, kind == Kind::Letter),
        "reason": text(e, "document.reason", &doc.reason, MAX_LONG, false),
        "intro": text(e, "document.intro", &doc.intro, MAX_LONG, false),
        "closing": text(e, "document.closing", &doc.closing, MAX_LONG, false),
    });

    if kind.has_items() {
        if doc.items.is_empty() || doc.items.len() > MAX_ITEMS {
            e.add("document.items", &format!("needs 1 to {MAX_ITEMS} items"));
        }
        let mut checked_items = Vec::new();
        let mut priced = Vec::new();
        for (i, item) in doc.items.iter().take(MAX_ITEMS).enumerate() {
            let ip = format!("document.items[{i}]");
            let tax_rate = match item.tax_rate {
                None => 19,
                Some(t) if t.fract() == 0.0 && TAX_RATES.contains(&(t as i64)) => t as i64,
                Some(_) => {
                    e.add(&format!("{ip}.taxRate"), "must be one of: 19, 7, 0");
                    19
                }
            };
            let unit = one_of(e, &format!("{ip}.unit"), item.unit.as_ref(), UNITS, "pcs");
            let quantity = number(e, &format!("{ip}.quantity"), item.quantity);
            let price = number(e, &format!("{ip}.price"), item.price);
            checked_items.push(json!({
                "description": text(e, &format!("{ip}.description"), &item.description, MAX_LONG, true),
            }));
            priced.push(Item {
                description: String::new(),
                quantity,
                unit: Some(unit),
                price,
                tax_rate: Some(tax_rate as f64),
            });
        }
        out["items"] = JsonValue::Array(checked_items);
        describe_items(english, &priced, kind == Kind::CreditNote, &mut out);
    }
    out
}

/// Template data and virtual files of one document. A credit note gets an EN 16931 credit note XML
/// (ZUGFeRD / XRechnung, TypeCode 381) when `settings.zugferd` is on; it uses the e-invoice fields
/// of the recipient (VAT id, e-mail, buyer reference).
pub fn build(
    kind: Kind,
    raw: &Settings,
    settings: JsonValue,
    doc: &Document,
    checked: JsonValue,
    mut assets: Vec<(String, Vec<u8>)>,
) -> (JsonValue, Vec<(String, Vec<u8>)>) {
    let mut data = json!({ "settings": settings, "doc": checked });
    if kind == Kind::CreditNote {
        let invoice = Invoice {
            number: doc.number.clone(),
            date: doc.date.clone(),
            recipient: doc.recipient.clone(),
            items: doc.items.clone(),
        };
        let prepared = einvoice::prepare(
            raw,
            &data["settings"],
            &invoice,
            &mut json!({}),
            Some((&doc.reference, &doc.reference_date)),
        );
        if let Some(xml) = prepared.xml {
            if xml.draft {
                tracing::warn!(event = "einvoice_draft", document = kind.slug(), problems = ?xml.problems);
            }
            assets.push(("xml".to_string(), xml.bytes));
            data["einvoice"] = prepared.extra["einvoice"].clone();
        }
    }
    (data, assets)
}

/// File name stem for the download: `<type>-<number>`.
pub fn file_name(kind: Kind, doc: &Document) -> String {
    let stem: String = doc
        .number
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' })
        .take(80)
        .collect();
    if stem.is_empty() {
        format!("{}.pdf", kind.slug())
    } else {
        format!("{}-{stem}.pdf", kind.slug())
    }
}

/// Name inside a bulk ZIP: the download name, made unique by the position when it repeats.
pub fn zip_name(kind: Kind, doc: &Document, index: usize, used: &mut std::collections::HashSet<String>) -> String {
    let name = file_name(kind, doc);
    if used.insert(name.clone()) {
        name
    } else {
        let alt = format!("{}-{}.pdf", name.trim_end_matches(".pdf"), index + 1);
        used.insert(alt.clone());
        alt
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(kind: Kind) -> Document {
        serde_json::from_value(json!({
            "number": "G-1", "date": "2026-01-31", "reference": "R-1",
            "subject": "Hallo", "body": "Text",
            "recipient": {"name": "A", "address": "B", "city": "12345 C"},
            "items": [{"description": "x", "quantity": 2, "unit": "h", "price": 10.5, "taxRate": 19}],
        }))
        .map(|d: Document| {
            let _ = kind;
            d
        })
        .unwrap()
    }

    #[test]
    fn credit_note_amounts_are_negative() {
        let mut e = Errors::default();
        let out = check_document(Kind::CreditNote, &sample(Kind::CreditNote), false, &mut e);
        assert!(e.0.is_empty(), "{:?}", e.0);
        assert_eq!(out["totals"]["net"], "-21,00\u{a0}€");
        assert_eq!(out["totals"]["gross"], "-24,99\u{a0}€");
    }

    #[test]
    fn letter_needs_subject_and_body() {
        let mut doc = sample(Kind::Letter);
        doc.subject.clear();
        doc.body.clear();
        let mut e = Errors::default();
        check_document(Kind::Letter, &doc, false, &mut e);
        assert_eq!(e.0.len(), 2);
    }

    #[test]
    fn zip_names_stay_unique() {
        let doc = sample(Kind::Offer);
        let mut used = std::collections::HashSet::new();
        let a = zip_name(Kind::Offer, &doc, 0, &mut used);
        let b = zip_name(Kind::Offer, &doc, 1, &mut used);
        assert_ne!(a, b);
    }

    #[test]
    fn credit_note_xml_references_the_invoice() {
        let raw: Settings = serde_json::from_value(json!({"zugferd": true, "vatId": "DE123456789"})).unwrap();
        let mut doc = sample(Kind::CreditNote);
        doc.reference_date = "2026-01-15".into();
        let (data, assets) = build(Kind::CreditNote, &raw, json!({}), &doc, json!({}), vec![]);
        let xml = assets.iter().find(|(k, _)| k == "xml").map(|(_, v)| String::from_utf8_lossy(v).to_string());
        let xml = xml.expect("xml asset");
        assert!(xml.contains("<ram:TypeCode>381</ram:TypeCode>"), "{xml}");
        assert!(xml.contains("InvoiceReferencedDocument") && xml.contains("R-1"));
        assert!(data.get("einvoice").is_some());
    }

    #[test]
    fn kinds_round_trip() {
        for k in Kind::ALL {
            assert_eq!(Kind::parse(k.slug()), Some(k));
        }
        assert!(Kind::parse("invoice").is_none());
    }
}
