//! Non-invoice documents for `/v1/documents`: credit note (Stornorechnung), offer, order
//! confirmation, delivery note, letter, dunning letter (Mahnung, see `dunning.rs`) and report (tables,
//! see `report.rs`).
//!
//! Same rules as `invoice.rs`: strict validation, whitelisted values, all text escaped for Typst
//! string literals. Each type has its own template (`frontend/src/template/<type>.typ`) that is
//! appended to the shared `layout.typ`. No e-invoice XML is produced for these types.

use crate::dunning::{self, DunningFee, DunningInterest, DunningInvoice};
use crate::einvoice::{self, describe_items, german_date};
use crate::invoice::{
    number, one_of, text, valid_date, Errors, Invoice, Item, Recipient, Settings, MAX_ITEMS,
    MAX_LONG, MAX_SHORT, TAX_RATES, UNITS,
};
use crate::postage::{self, Postage};
use crate::report::{self, ReportMeta, ReportTable};
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};
use std::sync::LazyLock;
use utoipa::ToSchema;

const MAX_BODY: usize = 10_000;

const COMMON: &str = include_str!("../../frontend/src/template/layout.typ");

/// Type of a document; selects the template.
#[derive(Clone, Copy, PartialEq, Eq, Debug, ToSchema)]
#[schema(as = DocumentType, rename_all = "kebab-case")]
pub enum Kind {
    CreditNote,
    Offer,
    Order,
    DeliveryNote,
    Letter,
    Dunning,
    Report,
}

impl Kind {
    pub const ALL: [Kind; 7] = [
        Kind::CreditNote,
        Kind::Offer,
        Kind::Order,
        Kind::DeliveryNote,
        Kind::Letter,
        Kind::Dunning,
        Kind::Report,
    ];

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
            Kind::Dunning => "dunning",
            Kind::Report => "report",
        }
    }

    fn body(self) -> &'static str {
        match self {
            Kind::CreditNote => include_str!("../../frontend/src/template/credit-note.typ"),
            Kind::Offer => include_str!("../../frontend/src/template/offer.typ"),
            Kind::Order => include_str!("../../frontend/src/template/order.typ"),
            Kind::DeliveryNote => include_str!("../../frontend/src/template/delivery-note.typ"),
            Kind::Letter => include_str!("../../frontend/src/template/letter.typ"),
            Kind::Dunning => include_str!("../../frontend/src/template/dunning.typ"),
            Kind::Report => include_str!("../../frontend/src/template/report.typ"),
        }
    }

    /// Complete Typst source: shared preamble plus the type's own layout (built once).
    pub fn template(self) -> &'static str {
        static TEMPLATES: LazyLock<Vec<String>> = LazyLock::new(|| {
            Kind::ALL
                .iter()
                .map(|k| format!("{COMMON}\n{}", k.body()))
                .collect()
        });
        let position = Kind::ALL
            .iter()
            .position(|k| *k == self)
            .expect("every kind is in Kind::ALL");
        &TEMPLATES[position]
    }

    fn has_items(self) -> bool {
        !matches!(self, Kind::Letter | Kind::Dunning | Kind::Report)
    }

    fn has_number(self) -> bool {
        !matches!(self, Kind::Letter | Kind::Report)
    }
}

/// A document; the required fields depend on `type` (see `POST /v1/documents`). `recipient` has only
/// `name`, `address` and `city` for letters, offers, orders and delivery notes; for credit notes the
/// e-invoice fields `vatId`, `email` and `buyerReference` are used as well.
#[derive(Deserialize, Default, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct Document {
    /// Document number (not used for letters).
    #[schema(max_length = 200)]
    pub number: String,
    /// Document date as `YYYY-MM-DD` (years 1970 to 2200).
    #[schema(format = Date)]
    pub date: String,
    pub recipient: Recipient,
    /// 1 to 500 items (not used for letters; delivery notes show no prices).
    #[schema(max_items = 500)]
    pub items: Vec<Item>,
    /// The cancelled invoice (credit note), the offer (order confirmation) or the order (delivery note).
    #[schema(max_length = 200)]
    pub reference: String,
    /// Date of the referenced document (`YYYY-MM-DD`).
    #[schema(format = Date)]
    pub reference_date: String,
    /// Offer: valid until (`YYYY-MM-DD`).
    #[schema(format = Date)]
    pub valid_until: String,
    /// Order confirmation and delivery note: delivery date (`YYYY-MM-DD`).
    #[schema(format = Date)]
    pub delivery_date: String,
    /// Letter subject.
    #[schema(max_length = 200)]
    pub subject: String,
    /// Letter text.
    #[schema(max_length = 10000)]
    pub body: String,
    /// Credit note: reason.
    #[schema(max_length = 2000)]
    pub reason: String,
    #[schema(max_length = 2000)]
    pub intro: String,
    #[schema(max_length = 2000)]
    pub closing: String,
    /// Dunning letter: level 1 (payment reminder), 2 (dunning letter) or 3 (final dunning letter).
    #[schema(minimum = 1, maximum = 3)]
    pub dunning_level: Option<f64>,
    /// Dunning letter: the open invoices (1 to 100).
    #[schema(max_items = 100)]
    pub invoices: Vec<DunningInvoice>,
    /// Dunning letter: fees and expenses (up to 20).
    #[schema(max_items = 20)]
    pub fees: Vec<DunningFee>,
    /// Dunning letter: default interest (§ 288 BGB) for a period, amount given by the caller.
    pub interest: Option<DunningInterest>,
    /// Dunning letter: new payment deadline (`YYYY-MM-DD`, not before the document date).
    #[schema(format = Date)]
    pub payment_deadline: String,
    /// Report: title (required).
    #[schema(max_length = 200)]
    pub title: String,
    /// Report: period as free text, for example `Januar bis Dezember 2026`.
    #[schema(max_length = 200)]
    pub period: String,
    /// Report: meta block, label and value pairs below the title (up to 12).
    #[schema(max_items = 12)]
    pub meta: Vec<ReportMeta>,
    /// Report: 1 to 20 tables with at most 10,000 rows in total.
    #[schema(max_items = 20)]
    pub tables: Vec<ReportTable>,
    /// Report: print on landscape A4.
    pub landscape: bool,
    /// Franking mark (Internetmarke PNG) printed into the address field.
    pub postage: Option<Postage>,
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
    let has_recipient = kind != Kind::Report;
    let mut out = json!({
        "kind": kind.slug(),
        "number": text(e, "document.number", &doc.number, MAX_SHORT, kind.has_number()),
        "year": date.0,
        "month": date.1,
        "day": date.2,
        "dateText": german_date(date),
        "recipient": {
            "name": text(e, "document.recipient.name", &r.name, MAX_SHORT, has_recipient),
            "address": text(e, "document.recipient.address", &r.address, MAX_SHORT, has_recipient),
            "city": text(e, "document.recipient.city", &r.city, MAX_SHORT, has_recipient),
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
    if kind == Kind::Dunning {
        out["dunning"] = dunning::check(
            &dunning::Fields {
                level: doc.dunning_level,
                invoices: &doc.invoices,
                fees: &doc.fees,
                interest: doc.interest.as_ref(),
                payment_deadline: &doc.payment_deadline,
                date,
            },
            e,
        );
    }
    if kind == Kind::Report {
        out["report"] = report::check(
            &report::Fields {
                title: &doc.title,
                period: &doc.period,
                meta: &doc.meta,
                tables: &doc.tables,
                landscape: doc.landscape,
            },
            english,
            e,
        );
        if doc.postage.is_some() {
            e.add("document.postage", "is not supported for reports");
        }
    } else if let Some(stamp) = postage::check_optional(doc.postage.as_ref(), "document", e) {
        out["postage"] = stamp.data();
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
    if kind != Kind::Report {
        postage::attach(doc.postage.as_ref(), &mut assets);
    }
    if kind == Kind::CreditNote {
        let invoice = Invoice {
            number: doc.number.clone(),
            date: doc.date.clone(),
            recipient: doc.recipient.clone(),
            items: doc.items.clone(),
            service_date: None,
            service_date_from: None,
            service_date_to: None,
            due_date: None,
            postage: None,
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
    if kind == Kind::Dunning {
        let deadline = valid_date(doc.payment_deadline.trim()).unwrap_or((1970, 1, 1));
        let total = data["doc"]["dunning"]["totalCents"].as_i64().unwrap_or(0);
        data["pay"] = einvoice::payment_data(raw, doc.number.trim(), total.into(), deadline);
        let mut audit = data["doc"]["dunning"]["audit"].take();
        if !audit.is_null() {
            audit["documentNumber"] = json!(doc.number.trim());
            audit["documentDate"] = json!(doc.date.trim());
            let bytes = serde_json::to_vec_pretty(&audit).unwrap_or_default();
            assets.push(("audit".to_string(), bytes));
            data["audit"] = json!({
                "file": dunning::AUDIT_FILE,
                "description": "Default interest calculation (machine-readable record)",
            });
        }
    }
    (data, assets)
}

/// File name for the download: `<type>-<number>.pdf`.
pub fn file_name(kind: Kind, doc: &Document) -> String {
    let stem: String = doc
        .number
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    if stem.is_empty() {
        format!("{}.pdf", kind.slug())
    } else {
        format!("{}-{stem}.pdf", kind.slug())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(_kind: Kind) -> Document {
        serde_json::from_value(json!({
            "number": "G-1", "date": "2026-01-31", "reference": "R-1",
            "subject": "Hallo", "body": "Text",
            "recipient": {"name": "A", "address": "B", "city": "12345 C"},
            "items": [{"description": "x", "quantity": 2, "unit": "h", "price": 10.5, "taxRate": 19}],
        }))
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
    fn template_is_shared_preamble_plus_layout() {
        for k in Kind::ALL {
            assert!(k.template().starts_with(COMMON) && k.template().ends_with(k.body()));
        }
    }

    #[test]
    fn credit_note_xml_references_the_invoice() {
        let raw: Settings =
            serde_json::from_value(json!({"zugferd": true, "vatId": "DE123456789"})).unwrap();
        let mut doc = sample(Kind::CreditNote);
        doc.reference_date = "2026-01-15".into();
        let (data, assets) = build(Kind::CreditNote, &raw, json!({}), &doc, json!({}), vec![]);
        let xml = assets
            .iter()
            .find(|(k, _)| k == "xml")
            .map(|(_, v)| String::from_utf8_lossy(v).to_string());
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
