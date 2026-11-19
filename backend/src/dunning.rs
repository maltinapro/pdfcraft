//! Dunning letter (Mahnung) for `/v1/documents` (`type: "dunning"`).
//!
//! Lists one or more open invoices with fees and default interest and asks for payment until a new
//! deadline. PDFCraft only lays out what it is given: the open amounts, fees and the interest amount
//! (§ 288 BGB) come from the caller, the sums are computed here with fixed-point cents so the
//! printed total and the amount of the EPC QR code always agree. Nothing is stored.

use crate::einvoice::{cents, decimal, german_date, money};
use crate::interest;
use crate::invoice::{text, valid_date, Errors, MAX_SHORT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use utoipa::ToSchema;

pub const MAX_INVOICES: usize = 100;
pub const MAX_FEES: usize = 20;
/// 1 payment reminder, 2 dunning letter, 3 final dunning letter.
pub const MAX_LEVEL: i64 = 3;

const MAX_AMOUNT: f64 = 1e9;
/// Name of the machine-readable calculation record in the PDF.
pub const AUDIT_FILE: &str = "dunning-interest.json";
const AUDIT_SCHEMA: &str = "pdfcraft.dunning-interest/1";
const VAT_NOTE: &str = "not subject to VAT (damages, § 288 BGB)";
const EURO: &str = "\u{a0}€";

/// An open invoice listed in a dunning letter.
#[derive(Serialize, Deserialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct DunningInvoice {
    /// Number of the open invoice.
    #[schema(required = true, max_length = 200)]
    pub number: String,
    /// Invoice date as `YYYY-MM-DD`.
    #[schema(required = true, format = Date)]
    pub date: String,
    /// Due date of the invoice as `YYYY-MM-DD` (not before the invoice date).
    #[schema(required = true, format = Date)]
    pub due_date: String,
    /// Still open gross amount in euro (greater than 0, at most 1e9).
    #[schema(required = true, minimum = 0, maximum = 1e9)]
    pub open_amount: f64,
}

/// A dunning fee or expense, for example the dunning fee.
#[derive(Serialize, Deserialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct DunningFee {
    /// Text of the line, for example `Mahngebühr`.
    #[schema(required = true, max_length = 200)]
    pub description: String,
    /// Amount in euro (0 to 1e9).
    #[schema(required = true, minimum = 0, maximum = 1e9)]
    pub amount: f64,
}

/// Default interest (Verzugszinsen, § 288 BGB) for a period. Either give `rate` and `amount` (nothing is
/// calculated) or give `debtor`, then PDFCraft calculates the interest per invoice from the base rate.
#[derive(Serialize, Deserialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct DunningInterest {
    /// Own calculation: annual interest rate in percent (greater than 0, at most 100), for example
    /// `12.27`. Needs `from`, `to` and `amount`; not allowed together with `debtor`.
    #[schema(minimum = 0, maximum = 100)]
    pub rate: Option<f64>,
    /// Start of the interest period as `YYYY-MM-DD`. Required with `rate`. With `debtor` it is optional;
    /// without it the interest of each invoice starts the day after its due date.
    #[schema(format = Date)]
    pub from: String,
    /// End of the interest period as `YYYY-MM-DD` (not before `from`), inclusive. Required with `rate`.
    /// With `debtor` it is optional and defaults to the document date.
    #[schema(format = Date)]
    pub to: String,
    /// Own calculation: interest amount in euro for the period (0 to 1e9). Required with `rate`; not
    /// allowed together with `debtor`.
    #[schema(minimum = 0, maximum = 1e9)]
    pub amount: Option<f64>,
    /// Calculate the interest: `consumer` (base rate + 5 percentage points, § 288 para. 1 BGB) or
    /// `business` (base rate + 9 percentage points, § 288 para. 2 BGB, transactions without a consumer).
    /// The interest of each invoice is its open amount x rate x days / 365, split at the half-yearly
    /// changes of the base rate (§ 247 BGB).
    #[schema(pattern = "^(consumer|business)$")]
    pub debtor: Option<String>,
    /// Calculation: base rate in percent (-10 to 20) for the whole period instead of the built-in table,
    /// for example for a period the table does not cover yet.
    #[schema(minimum = -10, maximum = 20)]
    pub base_rate: Option<f64>,
}

/// The dunning fields of a document.
pub struct Fields<'a> {
    pub level: Option<f64>,
    pub invoices: &'a [DunningInvoice],
    pub fees: &'a [DunningFee],
    pub interest: Option<&'a DunningInterest>,
    pub payment_deadline: &'a str,
    /// Document date (already validated by the caller).
    pub date: (i32, u32, u32),
}

fn date(e: &mut Errors, path: &str, iso: &str) -> Option<(i32, u32, u32)> {
    let parsed = valid_date(iso.trim());
    if parsed.is_none() {
        e.add(path, "must be a valid date as YYYY-MM-DD");
    }
    parsed
}

/// Amount in cents; `positive` rejects 0.
fn amount(e: &mut Errors, path: &str, value: f64, positive: bool) -> i128 {
    let range = if positive {
        "must be a number greater than 0 and at most 1e9"
    } else {
        "must be a number from 0 to 1e9"
    };
    if !value.is_finite() || value > MAX_AMOUNT {
        e.add(path, range);
        return 0;
    }
    let c = cents(value);
    if c < 0 || (positive && c == 0) {
        e.add(path, range);
        return 0;
    }
    c
}

fn euro(c: i128) -> String {
    format!("{}{EURO}", money(c))
}

fn percent(bp: i64) -> String {
    format!("{}\u{a0}%", decimal(i128::from(bp) * 100, 2, true))
}

/// Plain decimal for the machine-readable record (`1000.00`, `10.52`).
fn plain(hundredths: i128) -> String {
    decimal(hundredths * 100, 2, false)
}

fn day_text(day: i64) -> String {
    valid_date(&interest::iso_date(day)).map_or_else(String::new, german_date)
}

/// An open invoice as `(escaped number, raw number, open cents, due date)`.
type Open = (String, String, i128, Option<(i32, u32, u32)>);

/// Result of the interest part: cents, template data (`doc.dunning.interest`) and the record that is
/// attached to the PDF.
type Computed = (i128, JsonValue, JsonValue);

fn none() -> Computed {
    (0, JsonValue::Null, JsonValue::Null)
}

/// Validates `interest` and returns the amount in cents and the template data (`doc.dunning.interest`).
fn interest(
    e: &mut Errors,
    item: &DunningInterest,
    invoices: &[Open],
    document_date: (i32, u32, u32),
) -> Computed {
    let calculate = item.debtor.is_some();
    let explicit = |iso: &str| !iso.trim().is_empty();
    let from = if calculate && !explicit(&item.from) {
        None
    } else {
        date(e, "document.interest.from", &item.from)
    };
    let to = if calculate && !explicit(&item.to) {
        Some(document_date)
    } else {
        date(e, "document.interest.to", &item.to)
    };
    if let (Some(from), Some(to)) = (from, to) {
        if to < from {
            e.add("document.interest.to", "to must not be before from");
        }
    }

    if !calculate {
        if item.base_rate.is_some() {
            e.add(
                "document.interest.baseRate",
                "is only used together with debtor",
            );
        }
        match item.rate {
            Some(rate) if rate.is_finite() && rate > 0.0 && rate <= 100.0 => {}
            _ => e.add(
                "document.interest.rate",
                "must be a number greater than 0 and at most 100 (or send debtor to calculate)",
            ),
        }
        let value = item.amount.unwrap_or(f64::NAN);
        let total = amount(e, "document.interest.amount", value, false);
        let rate = item.rate.unwrap_or(0.0).clamp(0.0, 100.0);
        let audit = json!({
            "schema": AUDIT_SCHEMA,
            "legalBasis": "§ 288 BGB",
            "mode": "manual",
            "ratePercent": plain((rate * 100.0).round() as i128),
            "from": from.map(|(y, m, d)| format!("{y:04}-{m:02}-{d:02}")),
            "to": to.map(|(y, m, d)| format!("{y:04}-{m:02}-{d:02}")),
            "total": plain(total),
            "vat": VAT_NOTE,
        });
        return (
            total,
            json!({
                "calculated": false,
                "rate": percent((rate * 100.0).round() as i64),
                "fromText": from.map(german_date),
                "toText": to.map(german_date),
                "amount": euro(total),
            }),
            audit,
        );
    }

    for (path, present) in [
        ("document.interest.rate", item.rate.is_some()),
        ("document.interest.amount", item.amount.is_some()),
    ] {
        if present {
            e.add(
                path,
                "is calculated and must not be sent together with debtor",
            );
        }
    }
    let premium = item.debtor.as_deref().and_then(interest::premium);
    if premium.is_none() {
        e.add("document.interest.debtor", "must be consumer or business");
    }
    let base_override = match item.base_rate {
        Some(rate) if rate.is_finite() && (-10.0..=20.0).contains(&rate) => {
            Some((rate * 100.0).round() as i64)
        }
        Some(_) => {
            e.add(
                "document.interest.baseRate",
                "must be a number from -10 to 20",
            );
            None
        }
        None => None,
    };
    let (Some(premium), Some(to)) = (premium, to) else {
        return none();
    };

    let to_day = interest::days(to);
    let mut total = 0;
    let mut lines = Vec::new();
    let mut records = Vec::new();
    let (mut low, mut high) = (i64::MAX, i64::MIN);
    let mut earliest: Option<i64> = None;
    for (i, (number, raw_number, open, due)) in invoices.iter().enumerate() {
        let start = match (from, due) {
            (Some(from), _) => interest::days(from),
            (None, Some(due)) => interest::days(*due) + 1,
            (None, None) => continue,
        };
        if start > to_day {
            continue;
        }
        let segments = match interest::segments(start, to_day, base_override) {
            Ok(segments) => segments,
            Err(message) => {
                e.add(&format!("document.invoices[{i}].dueDate"), &message);
                break;
            }
        };
        let weighted: i128 = segments.iter().map(|s| s.weighted(*open, premium)).sum();
        let cents = interest::cents(weighted);
        total += cents;
        earliest = Some(earliest.map_or(start, |e| e.min(start)));
        for s in &segments {
            low = low.min(s.base);
            high = high.max(s.base);
        }
        lines.push(json!({
            "number": number,
            "principal": euro(*open),
            "amount": euro(cents),
            "periods": segments.iter().map(|s| json!({
                "from": day_text(s.from),
                "to": day_text(s.to),
                "days": s.days,
                "base": percent(s.base),
                "rate": percent(s.base + premium),
            })).collect::<Vec<_>>(),
        }));
        records.push(json!({
            "number": raw_number,
            "principal": plain(*open),
            "interest": plain(cents),
            "periods": segments.iter().map(|s| json!({
                "from": interest::iso_date(s.from),
                "to": interest::iso_date(s.to),
                "days": s.days,
                "baseRatePercent": plain(i128::from(s.base)),
                "ratePercent": plain(i128::from(s.base + premium)),
                "source": s.source,
            })).collect::<Vec<_>>(),
        }));
    }
    let range = |lo: i64, hi: i64| {
        if lo == hi {
            percent(lo)
        } else {
            format!("{} – {}", percent(lo), percent(hi))
        }
    };
    let (base_text, rate_text) = if lines.is_empty() {
        (percent(0), percent(premium))
    } else {
        (range(low, high), range(low + premium, high + premium))
    };
    let audit = json!({
        "schema": AUDIT_SCHEMA,
        "legalBasis": "§ 288 BGB",
        "mode": "calculated",
        "debtor": item.debtor,
        "premiumPercent": plain(i128::from(premium)),
        "dayCount": "actual days / 365, first and last day included",
        "to": interest::iso_date(to_day),
        "invoices": records,
        "total": plain(total),
        "vat": VAT_NOTE,
    });
    (
        total,
        json!({
            "calculated": true,
            "rate": rate_text,
            "base": base_text,
            "premium": decimal(i128::from(premium) * 100, 0, true),
            "fromText": from.map(german_date),
            "toText": german_date(to),
            "amount": euro(total),
            "lines": lines,
        }),
        audit,
    )
}

/// Validated template data of a dunning letter (`doc.dunning`) including the display texts and the
/// total in cents (`totalCents`, used for the payment block).
pub fn check(f: &Fields, e: &mut Errors) -> JsonValue {
    let level = match f.level {
        None => {
            e.add("document.dunningLevel", "is required");
            1
        }
        Some(l) if l.fract() == 0.0 && (1.0..=MAX_LEVEL as f64).contains(&l) => l as i64,
        Some(_) => {
            e.add(
                "document.dunningLevel",
                &format!("must be a whole number from 1 to {MAX_LEVEL}"),
            );
            1
        }
    };

    if f.invoices.is_empty() || f.invoices.len() > MAX_INVOICES {
        e.add(
            "document.invoices",
            &format!("needs 1 to {MAX_INVOICES} invoices"),
        );
    }
    let mut open_total = 0;
    let mut invoices = Vec::new();
    let mut open_items = Vec::new();
    for (i, inv) in f.invoices.iter().take(MAX_INVOICES).enumerate() {
        let p = format!("document.invoices[{i}]");
        let number = text(e, &format!("{p}.number"), &inv.number, MAX_SHORT, true);
        let issued = date(e, &format!("{p}.date"), &inv.date);
        let due = date(e, &format!("{p}.dueDate"), &inv.due_date);
        if issued.zip(due).is_some_and(|(issued, due)| due < issued) {
            e.add(
                &format!("{p}.dueDate"),
                "dueDate must not be before the invoice date",
            );
        }
        let open = amount(e, &format!("{p}.openAmount"), inv.open_amount, true);
        open_total += open;
        open_items.push((number.clone(), inv.number.trim().to_string(), open, due));
        invoices.push(json!({
            "number": number,
            "dateText": issued.map(german_date),
            "dueText": due.map(german_date),
            "open": euro(open),
        }));
    }

    if f.fees.len() > MAX_FEES {
        e.add(
            "document.fees",
            &format!("needs at most {MAX_FEES} entries"),
        );
    }
    let mut fee_total = 0;
    let mut fees = Vec::new();
    for (i, fee) in f.fees.iter().take(MAX_FEES).enumerate() {
        let p = format!("document.fees[{i}]");
        let description = text(
            e,
            &format!("{p}.description"),
            &fee.description,
            MAX_SHORT,
            true,
        );
        let value = amount(e, &format!("{p}.amount"), fee.amount, false);
        fee_total += value;
        fees.push(json!({ "description": description, "amount": euro(value) }));
    }

    let (interest_total, interest, audit) = match f.interest {
        Some(item) => interest(e, item, &open_items, f.date),
        None => none(),
    };

    let deadline = date(e, "document.paymentDeadline", f.payment_deadline);
    if deadline.is_some_and(|d| d < f.date) {
        e.add(
            "document.paymentDeadline",
            "paymentDeadline must not be before the document date",
        );
    }

    let total = open_total + fee_total + interest_total;
    json!({
        "level": level,
        "invoices": invoices,
        "fees": fees,
        "interest": interest,
        "audit": audit,
        "openTotal": euro(open_total),
        "total": euro(total),
        "totalCents": total as i64,
        "deadlineText": deadline.map(german_date),
        "deadline": deadline.map(|(y, m, d)| json!({ "year": y, "month": m, "day": d })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invoice(number: &str, open: f64) -> DunningInvoice {
        DunningInvoice {
            number: number.into(),
            date: "2026-01-05".into(),
            due_date: "2026-01-19".into(),
            open_amount: open,
        }
    }

    fn run(f: &Fields) -> (JsonValue, Vec<String>) {
        let mut e = Errors::default();
        let out = check(f, &mut e);
        (out, e.0)
    }

    #[test]
    fn sums_open_amounts_fees_and_interest_in_cents() {
        let invoices = [invoice("R-1", 100.10), invoice("R-2", 0.2)];
        let fees = [DunningFee {
            description: "Mahngebühr".into(),
            amount: 5.0,
        }];
        let interest = DunningInterest {
            rate: Some(12.27),
            from: "2026-01-20".into(),
            to: "2026-02-20".into(),
            amount: Some(1.07),
            debtor: None,
            base_rate: None,
        };
        let (out, errors) = run(&Fields {
            level: Some(2.0),
            invoices: &invoices,
            fees: &fees,
            interest: Some(&interest),
            payment_deadline: "2026-03-03",
            date: (2026, 2, 20),
        });
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(out["level"], 2);
        assert_eq!(out["openTotal"], "100,30\u{a0}€");
        assert_eq!(out["total"], "106,37\u{a0}€");
        assert_eq!(out["totalCents"], 10637);
        assert_eq!(out["invoices"][0]["dueText"], "19.01.2026");
        assert_eq!(out["interest"]["rate"], "12,27\u{a0}%");
        assert_eq!(out["interest"]["fromText"], "20.01.2026");
        assert_eq!(out["deadlineText"], "03.03.2026");
    }

    #[test]
    fn reports_every_problem_with_its_path() {
        let invoices = [DunningInvoice {
            number: String::new(),
            date: "2026-02-30".into(),
            due_date: "2026-01-01".into(),
            open_amount: 0.0,
        }];
        let fees = [DunningFee {
            description: "x".into(),
            amount: -1.0,
        }];
        let interest = DunningInterest {
            rate: Some(0.0),
            from: "2026-03-01".into(),
            to: "2026-02-01".into(),
            amount: Some(f64::NAN),
            debtor: None,
            base_rate: None,
        };
        let (_, errors) = run(&Fields {
            level: Some(4.0),
            invoices: &invoices,
            fees: &fees,
            interest: Some(&interest),
            payment_deadline: "2026-01-01",
            date: (2026, 2, 20),
        });
        for path in [
            "document.dunningLevel",
            "document.invoices[0].number",
            "document.invoices[0].date",
            "document.invoices[0].openAmount",
            "document.fees[0].amount",
            "document.interest.rate",
            "document.interest.to",
            "document.interest.amount",
            "document.paymentDeadline",
        ] {
            assert!(
                errors.iter().any(|m| m.starts_with(&format!("{path}:"))),
                "{path} in {errors:?}"
            );
        }
    }

    #[test]
    fn needs_a_level_and_at_least_one_invoice() {
        let (_, errors) = run(&Fields {
            level: None,
            invoices: &[],
            fees: &[],
            interest: None,
            payment_deadline: "2026-03-03",
            date: (2026, 2, 20),
        });
        assert!(errors
            .iter()
            .any(|m| m.starts_with("document.dunningLevel:")));
        assert!(errors.iter().any(|m| m.starts_with("document.invoices:")));
        assert_eq!(errors.len(), 2, "{errors:?}");
    }

    #[test]
    fn limits_the_number_of_invoices_and_fees() {
        let invoices = vec![invoice("R", 1.0); MAX_INVOICES + 1];
        let fees = vec![
            DunningFee {
                description: "Gebühr".into(),
                amount: 1.0
            };
            MAX_FEES + 1
        ];
        let (_, errors) = run(&Fields {
            level: Some(1.0),
            invoices: &invoices,
            fees: &fees,
            interest: None,
            payment_deadline: "2026-03-03",
            date: (2026, 2, 20),
        });
        assert!(errors.iter().any(|m| m.starts_with("document.invoices:")));
        assert!(errors.iter().any(|m| m.starts_with("document.fees:")));
    }
}
