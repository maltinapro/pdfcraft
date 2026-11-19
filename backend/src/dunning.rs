//! Dunning letter (Mahnung) for `/v1/documents` (`type: "dunning"`).
//!
//! Lists one or more open invoices with fees and default interest and asks for payment until a new
//! deadline. PDFCraft only lays out what it is given: the open amounts, fees and the interest amount
//! (§ 288 BGB) come from the caller, the sums are computed here with fixed-point cents so the
//! printed total and the amount of the EPC QR code always agree. Nothing is stored.

use crate::einvoice::{cents, decimal, german_date, money};
use crate::invoice::{text, valid_date, Errors, MAX_SHORT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use utoipa::ToSchema;

pub const MAX_INVOICES: usize = 100;
pub const MAX_FEES: usize = 20;
/// 1 payment reminder, 2 dunning letter, 3 final dunning letter.
pub const MAX_LEVEL: i64 = 3;

const MAX_AMOUNT: f64 = 1e9;
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

/// Default interest (Verzugszinsen, § 288 BGB) for a period. The amount is not calculated by PDFCraft.
#[derive(Serialize, Deserialize, Default, Clone, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct DunningInterest {
    /// Annual interest rate in percent (greater than 0, at most 100), for example `12.27`.
    #[schema(required = true, minimum = 0, maximum = 100)]
    pub rate: f64,
    /// Start of the interest period as `YYYY-MM-DD`.
    #[schema(required = true, format = Date)]
    pub from: String,
    /// End of the interest period as `YYYY-MM-DD` (not before `from`).
    #[schema(required = true, format = Date)]
    pub to: String,
    /// Interest amount in euro for the period (0 to 1e9), calculated by the caller.
    #[schema(required = true, minimum = 0, maximum = 1e9)]
    pub amount: f64,
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

    let mut interest_total = 0;
    let mut interest = JsonValue::Null;
    if let Some(item) = f.interest {
        let from = date(e, "document.interest.from", &item.from);
        let to = date(e, "document.interest.to", &item.to);
        if from.zip(to).is_some_and(|(from, to)| to < from) {
            e.add("document.interest.to", "to must not be before from");
        }
        if !item.rate.is_finite() || item.rate <= 0.0 || item.rate > 100.0 {
            e.add(
                "document.interest.rate",
                "must be a number greater than 0 and at most 100",
            );
        }
        interest_total = amount(e, "document.interest.amount", item.amount, false);
        interest = json!({
            "rate": format!("{}\u{a0}%", decimal((item.rate.clamp(0.0, 100.0) * 10_000.0).round() as i128, 2, true)),
            "fromText": from.map(german_date),
            "toText": to.map(german_date),
            "amount": euro(interest_total),
        });
    }

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
            rate: 12.27,
            from: "2026-01-20".into(),
            to: "2026-02-20".into(),
            amount: 1.07,
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
            rate: 0.0,
            from: "2026-03-01".into(),
            to: "2026-02-01".into(),
            amount: f64::NAN,
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
