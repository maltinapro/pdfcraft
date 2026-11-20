//! Limited plausibility check of a received e-invoice: mandatory fields, arithmetic and a selection of EN 16931 /
//! XRechnung rules (`rules.rs`), a port of `frontend/src/lib/einvoice/check.ts`. It is NOT a validation against the EN 16931 / XRechnung rules
//! (see [`not_checked`]); a response never calls a file "valid".

use super::rules::rule_checks;
use super::view::{InvoiceView, LineView};
use serde::Serialize;
use utoipa::ToSchema;

/// Language of the finding texts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    De,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Checked and fine.
    Ok,
    /// Finding of low severity (payment details, dates).
    Warning,
    /// Finding: a mandatory field is missing or an amount does not add up.
    Error,
    /// Could not be checked because data is missing in the file.
    Skipped,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// Stable identifier of the check, e.g. `header`, `line-math`, `gross-total`.
    pub id: String,
    /// What the check verifies, in the requested language.
    pub title: String,
    pub status: Status,
    /// Findings in plain language (why it failed or was skipped); empty when `ok`.
    pub findings: Vec<String>,
}

/// Tolerance for products that are rounded in different ways by different software (1 cent).
const ROUNDING_CENTS: f64 = 1.0;

/// Tax categories (UNCL 5305) for which a reason for the missing VAT is mandatory.
const NEEDS_REASON: [&str; 5] = ["E", "AE", "K", "G", "O"];
/// Tax categories with a 0 % rate.
const ZERO_RATE: [&str; 6] = ["Z", "E", "AE", "K", "G", "O"];

/// `Math.sign`: unlike `f64::signum`, zero (and negative zero) stays zero.
fn js_sign(n: f64) -> f64 {
    if n == 0.0 || n.is_nan() {
        n
    } else {
        n.signum()
    }
}

/// Cents of an amount, half away from zero, tolerant to binary floating point noise (1.005 -> 101).
fn cents(n: f64) -> f64 {
    let scaled = n * 100.0;
    let rounded: f64 = format!("{scaled:.11e}").parse().unwrap_or(scaled);
    js_sign(n) * rounded.abs().round()
}

pub(super) fn iban_ok(raw: &str) -> bool {
    let iban: String = raw.split_whitespace().collect::<String>().to_uppercase();
    let b = iban.as_bytes();
    let shape = b.len() >= 15
        && b.len() <= 34
        && b[..2].iter().all(u8::is_ascii_uppercase)
        && b[2..4].iter().all(u8::is_ascii_digit)
        && b[4..]
            .iter()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if !shape {
        return false;
    }
    let mut rest: u32 = 0;
    for c in iban[4..].chars().chain(iban[..4].chars()) {
        let value = if c.is_ascii_digit() {
            c as u32 - '0' as u32
        } else {
            c as u32 - 55
        };
        // letters are two digits (10..35)
        rest = if value >= 10 {
            (rest * 100 + value) % 97
        } else {
            (rest * 10 + value) % 97
        };
    }
    rest == 1
}

fn real_date(iso: Option<&str>) -> bool {
    let Some(iso) = iso else { return false };
    let b = iso.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return false;
    }
    let number = |range: std::ops::Range<usize>| iso[range].parse::<u32>().unwrap_or(0);
    let (year, month, day) = (number(0..4), number(5..7), number(8..10));
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

/// An amount with two decimals and thousands separators like `Intl.NumberFormat` (`de-DE`: `1.234,56`,
/// `en-GB`: `1,234.56`), rounded half away from zero from the shortest decimal form of the number.
fn format_amount(n: f64, lang: Lang) -> String {
    if !n.is_finite() {
        return if n.is_nan() {
            "NaN".to_string()
        } else if n < 0.0 {
            "-∞".to_string()
        } else {
            "∞".to_string()
        };
    }
    let (group, decimal) = match lang {
        Lang::De => ('.', ','),
        Lang::En => (',', '.'),
    };
    let sci = format!("{:e}", n.abs());
    let (mantissa, exponent) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: Vec<u8> = mantissa.bytes().filter(u8::is_ascii_digit).collect();
    let exponent: i64 = exponent.parse().unwrap_or(0);
    // |n| * 100 = digits * 10^shift
    let shift = exponent + 2 - (digits.len() as i64 - 1);
    let mut cents: Vec<u8> = if shift >= 0 {
        let mut d = digits.clone();
        d.extend(std::iter::repeat_n(b'0', shift as usize));
        d
    } else {
        let keep = digits.len() as i64 + shift;
        if keep < 0 {
            Vec::new()
        } else {
            let keep = keep as usize;
            let mut d = digits[..keep].to_vec();
            if digits[keep] >= b'5' {
                let mut i = d.len();
                loop {
                    if i == 0 {
                        d.insert(0, b'1');
                        break;
                    }
                    i -= 1;
                    if d[i] == b'9' {
                        d[i] = b'0';
                    } else {
                        d[i] += 1;
                        break;
                    }
                }
            }
            d
        }
    };
    while cents.len() < 3 {
        cents.insert(0, b'0');
    }
    let split = cents.len() - 2;
    let int_part = String::from_utf8_lossy(&cents[..split])
        .trim_start_matches('0')
        .to_string();
    let int_part = if int_part.is_empty() {
        "0".to_string()
    } else {
        int_part
    };
    let mut grouped = String::new();
    for (i, c) in int_part.chars().enumerate() {
        if i > 0 && (int_part.len() - i) % 3 == 0 {
            grouped.push(group);
        }
        grouped.push(c);
    }
    let sign = if n.is_sign_negative() { "-" } else { "" };
    format!(
        "{sign}{grouped}{decimal}{}",
        String::from_utf8_lossy(&cents[split..])
    )
}

/// Number to text like a JavaScript template literal (`19`, `7.5`).
fn plain(n: f64) -> String {
    if n == 0.0 {
        "0".to_string()
    } else {
        n.to_string()
    }
}

pub(super) struct Ctx {
    lang: Lang,
}

impl Ctx {
    pub(super) fn tr(&self, de: &str, en: &str) -> String {
        match self.lang {
            Lang::De => de,
            Lang::En => en,
        }
        .to_string()
    }

    pub(super) fn pick(&self, de: String, en: String) -> String {
        match self.lang {
            Lang::De => de,
            Lang::En => en,
        }
    }

    fn money(&self, n: Option<f64>, currency: Option<&str>) -> String {
        let Some(n) = n else {
            return "–".to_string();
        };
        let value = format_amount(n, self.lang);
        match currency {
            Some(c) if !c.is_empty() => format!("{value} {c}"),
            _ => value,
        }
    }

    pub(super) fn line_label(&self, line: &LineView, index: usize) -> String {
        let id = line.id.clone().unwrap_or_else(|| (index + 1).to_string());
        self.pick(format!("Position {id}"), format!("Line {id}"))
    }
}

type RateKey = (String, String);

fn rate_key(category: Option<&str>, rate: Option<f64>) -> RateKey {
    (
        category.unwrap_or("?").to_string(),
        rate.map_or("?".to_string(), plain),
    )
}

fn add(
    results: &mut Vec<CheckResult>,
    id: &str,
    title: String,
    findings: Vec<String>,
    severity: Status,
) {
    results.push(CheckResult {
        id: id.to_string(),
        title,
        status: if findings.is_empty() {
            Status::Ok
        } else {
            severity
        },
        findings,
    });
}

fn skip(results: &mut Vec<CheckResult>, id: &str, title: String, reason: String) {
    results.push(CheckResult {
        id: id.to_string(),
        title,
        status: Status::Skipped,
        findings: vec![reason],
    });
}

/// Sum that starts at positive zero like `reduce((a, b) => a + b, 0)` (`Iterator::sum` starts at -0.0).
fn total(list: impl IntoIterator<Item = f64>) -> f64 {
    list.into_iter().fold(0.0, |a, b| a + b)
}

pub fn run_checks(view: &InvoiceView, lang: Lang) -> Vec<CheckResult> {
    let c = Ctx { lang };
    let mut r: Vec<CheckResult> = Vec::new();
    let cur = view.currency.as_deref();
    let t = &view.totals;
    let money = |n: Option<f64>| c.money(n, cur);
    let amount = |n: f64| c.money(Some(n), cur);
    let no_data = || {
        c.tr(
            "Nicht prüfbar: Beträge fehlen in der Datei.",
            "Not checked: amounts are missing in the file.",
        )
    };
    let err = Status::Error;

    // 1. Mandatory header fields
    let mut header: Vec<String> = Vec::new();
    if view.number.is_none() {
        header.push(c.tr(
            "Rechnungsnummer (BT-1) fehlt",
            "Invoice number (BT-1) is missing",
        ));
    }
    if view.issue_date.is_none() {
        header.push(c.tr(
            "Rechnungsdatum (BT-2) fehlt",
            "Issue date (BT-2) is missing",
        ));
    }
    if view.type_code.is_none() {
        header.push(c.tr(
            "Rechnungstyp (BT-3) fehlt",
            "Invoice type code (BT-3) is missing",
        ));
    }
    match cur {
        None => header.push(c.tr("Währung (BT-5) fehlt", "Currency (BT-5) is missing")),
        Some(code) if !(code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase())) => {
            header.push(c.pick(
                format!("Währung „{code}“ ist kein dreibuchstabiger Code"),
                format!("Currency \"{code}\" is not a three-letter code"),
            ));
        }
        Some(_) => {}
    }
    if view.profile.is_none() {
        header.push(c.tr(
            "Spezifikationskennung (BT-24) fehlt",
            "Specification identifier (BT-24) is missing",
        ));
    }
    add(
        &mut r,
        "header",
        c.tr(
            "Pflichtangaben im Kopf (Nummer, Datum, Typ, Währung, Spezifikation)",
            "Mandatory header fields (number, date, type, currency, specification)",
        ),
        header,
        err,
    );

    // 2. Parties
    let mut parties: Vec<String> = Vec::new();
    if view.seller.name.is_none() {
        parties.push(c.tr(
            "Name des Verkäufers (BT-27) fehlt",
            "Seller name (BT-27) is missing",
        ));
    }
    if view.seller.city.is_none() {
        parties.push(c.tr(
            "Ort des Verkäufers (BT-37) fehlt",
            "Seller city (BT-37) is missing",
        ));
    }
    if view.seller.country.is_none() {
        parties.push(c.tr(
            "Land des Verkäufers (BT-40) fehlt",
            "Seller country (BT-40) is missing",
        ));
    }
    if view.seller.vat_id.is_none()
        && view.seller.tax_number.is_none()
        && view.seller.registration.is_none()
    {
        parties.push(c.tr(
            "Keine Steuer- oder Registerkennung des Verkäufers (USt-IdNr., Steuernummer oder Handelsregister)",
            "No seller tax or legal identifier (VAT ID, tax number or registration)",
        ));
    }
    if view.buyer.name.is_none() {
        parties.push(c.tr(
            "Name des Käufers (BT-44) fehlt",
            "Buyer name (BT-44) is missing",
        ));
    }
    if view.buyer.country.is_none() {
        parties.push(c.tr(
            "Land des Käufers (BT-55) fehlt",
            "Buyer country (BT-55) is missing",
        ));
    }
    add(
        &mut r,
        "parties",
        c.tr(
            "Pflichtangaben zu Verkäufer und Käufer",
            "Mandatory seller and buyer details",
        ),
        parties,
        err,
    );

    // 3. Lines present and complete
    let mut lines: Vec<String> = Vec::new();
    if view.items.is_empty() {
        lines.push(c.tr(
            "Die Rechnung enthält keine Position",
            "The invoice has no line",
        ));
    }
    for (i, line) in view.items.iter().enumerate() {
        let mut missing: Vec<String> = Vec::new();
        if line.name.is_none() {
            missing.push(c.tr("Bezeichnung", "name"));
        }
        if line.quantity.is_none() {
            missing.push(c.tr("Menge", "quantity"));
        }
        if line.unit.as_deref().unwrap_or("").is_empty() {
            missing.push(c.tr("Einheit", "unit"));
        }
        if line.price.is_none() {
            missing.push(c.tr("Einzelpreis", "unit price"));
        }
        if line.net.is_none() {
            missing.push(c.tr("Nettobetrag", "net amount"));
        }
        if line.tax_category.is_none() {
            missing.push(c.tr("Steuerkategorie", "tax category"));
        }
        if !missing.is_empty() {
            lines.push(format!(
                "{}: {} {}",
                c.line_label(line, i),
                c.tr("fehlt", "missing"),
                missing.join(", ")
            ));
        }
    }
    add(
        &mut r,
        "lines",
        c.tr(
            "Positionen vorhanden und vollständig",
            "Lines present and complete",
        ),
        lines,
        err,
    );

    // 4. Line amount = quantity x price
    let mut line_math: Vec<String> = Vec::new();
    let mut line_math_checked = 0;
    for (i, line) in view.items.iter().enumerate() {
        let (Some(quantity), Some(price), Some(net)) = (line.quantity, line.price, line.net) else {
            continue;
        };
        if line.has_adjustments {
            continue;
        }
        line_math_checked += 1;
        let expected = cents(quantity * price / line.price_basis);
        if (expected - cents(net)).abs() > ROUNDING_CENTS {
            line_math.push(format!(
                "{}: {} {}, {} {}",
                c.line_label(line, i),
                c.tr("Menge × Preis ergibt", "quantity × price gives"),
                amount(expected / 100.0),
                c.tr("angegeben", "stated"),
                money(Some(net))
            ));
        }
    }
    let line_math_title = c.tr(
        "Positionsbetrag = Menge × Einzelpreis (je Position, 1 Cent Rundungstoleranz)",
        "Line amount = quantity × unit price (per line, 1 cent rounding tolerance)",
    );
    if !view.items.is_empty() && line_math_checked == 0 {
        skip(
            &mut r,
            "line-math",
            line_math_title,
            c.tr(
                "Keine Position mit Menge, Preis und Betrag ohne Positionsrabatt.",
                "No line with quantity, price and amount without a line allowance.",
            ),
        );
    } else {
        add(&mut r, "line-math", line_math_title, line_math, err);
    }

    // 5. Sum of lines
    let sum_title = c.tr(
        "Summe der Positionen = Summe Positionsbeträge",
        "Sum of lines = line total",
    );
    match t.line_total {
        Some(line_total) if view.items.iter().all(|l| l.net.is_some()) => {
            let sum = total(view.items.iter().map(|l| cents(l.net.unwrap_or(0.0))));
            let findings = if sum == cents(line_total) {
                vec![]
            } else {
                vec![c.pick(
                    format!(
                        "Positionen ergeben {}, angegeben {}",
                        amount(sum / 100.0),
                        money(Some(line_total))
                    ),
                    format!(
                        "Lines add up to {}, stated {}",
                        amount(sum / 100.0),
                        money(Some(line_total))
                    ),
                )]
            };
            add(&mut r, "line-sum", sum_title, findings, err);
        }
        _ => skip(&mut r, "line-sum", sum_title, no_data()),
    }

    // 6. Net total
    let net_title = c.tr(
        "Nettosumme = Positionen − Nachlässe + Zuschläge",
        "Net total = lines − allowances + charges",
    );
    match (t.line_total, t.tax_basis) {
        (Some(line_total), Some(tax_basis)) => {
            let sum_of = |charge: bool| -> f64 {
                total(
                    view.adjustments
                        .iter()
                        .filter(|a| a.charge == charge)
                        .map(|a| cents(a.amount.unwrap_or(0.0))),
                )
            };
            let allowance = t.allowance_total.map_or_else(|| sum_of(false), cents);
            let charge = t.charge_total.map_or_else(|| sum_of(true), cents);
            let mut findings: Vec<String> = Vec::new();
            let expected = cents(line_total) - allowance + charge;
            if expected != cents(tax_basis) {
                findings.push(c.pick(
                    format!(
                        "Ergibt {}, angegeben {}",
                        amount(expected / 100.0),
                        money(Some(tax_basis))
                    ),
                    format!(
                        "Gives {}, stated {}",
                        amount(expected / 100.0),
                        money(Some(tax_basis))
                    ),
                ));
            }
            if !view.adjustments.is_empty()
                && t.allowance_total.is_some_and(|a| sum_of(false) != cents(a))
            {
                findings.push(c.tr(
                    "Summe der Nachlässe weicht von der angegebenen Gesamtsumme ab",
                    "Sum of allowances differs from the stated total",
                ));
            }
            if !view.adjustments.is_empty()
                && t.charge_total.is_some_and(|a| sum_of(true) != cents(a))
            {
                findings.push(c.tr(
                    "Summe der Zuschläge weicht von der angegebenen Gesamtsumme ab",
                    "Sum of charges differs from the stated total",
                ));
            }
            add(&mut r, "net-total", net_title, findings, err);
        }
        _ => skip(&mut r, "net-total", net_title, no_data()),
    }

    // 7. Tax basis per category and rate
    let basis_title = c.tr(
        "Steuerbasis je Kategorie und Satz = Positionen − Nachlässe + Zuschläge",
        "Tax basis per category and rate = lines − allowances + charges",
    );
    if view.taxes.is_empty() {
        skip(
            &mut r,
            "tax-basis",
            basis_title,
            c.tr(
                "Nicht prüfbar: keine Steueraufschlüsselung in der Datei.",
                "Not checked: no tax breakdown in the file.",
            ),
        );
    } else if view.items.iter().any(|l| l.net.is_none()) {
        skip(&mut r, "tax-basis", basis_title, no_data());
    } else {
        let mut expected: Vec<(RateKey, f64)> = Vec::new();
        let mut bump =
            |key: RateKey, amount: f64| match expected.iter_mut().find(|(k, _)| *k == key) {
                Some((_, value)) => *value += amount,
                None => expected.push((key, amount + 0.0)),
            };
        for l in &view.items {
            bump(
                rate_key(l.tax_category.as_deref(), l.tax_rate),
                cents(l.net.unwrap_or(0.0)),
            );
        }
        for a in &view.adjustments {
            let sign = if a.charge { 1.0 } else { -1.0 };
            bump(
                rate_key(a.tax_category.as_deref(), a.tax_rate),
                sign * cents(a.amount.unwrap_or(0.0)),
            );
        }
        let mut findings: Vec<String> = Vec::new();
        // `None`: a breakdown of this key has no basis amount (NaN in the TypeScript reader)
        let mut stated: Vec<(RateKey, Option<f64>)> = Vec::new();
        for tax in &view.taxes {
            let key = rate_key(tax.category.as_deref(), tax.rate);
            let value = tax.basis.map(cents);
            match stated.iter_mut().find(|(k, _)| *k == key) {
                Some((_, v)) => *v = v.zip(value).map(|(a, b)| a + b),
                None => stated.push((key, value.map(|b| b + 0.0))),
            }
        }
        for ((category, rate), value) in &stated {
            let label = format!("{category} {rate} %");
            let exp = expected
                .iter()
                .find(|(k, _)| k.0 == *category && k.1 == *rate)
                .map_or(0.0, |(_, v)| *v);
            match value {
                None => findings.push(c.pick(
                    format!("{label}: Steuerbasis fehlt"),
                    format!("{label}: tax basis is missing"),
                )),
                Some(value) if exp != *value => findings.push(c.pick(
                    format!(
                        "{label}: Positionen ergeben {}, angegeben {}",
                        amount(exp / 100.0),
                        amount(value / 100.0)
                    ),
                    format!(
                        "{label}: lines give {}, stated {}",
                        amount(exp / 100.0),
                        amount(value / 100.0)
                    ),
                )),
                Some(_) => {}
            }
        }
        for ((category, rate), exp) in &expected {
            if !stated.iter().any(|(k, _)| k.0 == *category && k.1 == *rate) && *exp != 0.0 {
                findings.push(c.pick(
                    format!("{category} {rate} %: Positionen vorhanden, aber keine Steueraufschlüsselung"),
                    format!("{category} {rate} %: lines exist but no tax breakdown"),
                ));
            }
        }
        add(&mut r, "tax-basis", basis_title, findings, err);
    }

    // 8. Tax amount = basis x rate
    let tax_title = c.tr(
        "Steuerbetrag = Steuerbasis × Satz (je Aufschlüsselung, 1 Cent Rundungstoleranz)",
        "Tax amount = tax basis × rate (per breakdown, 1 cent rounding tolerance)",
    );
    let computable: Vec<_> = view
        .taxes
        .iter()
        .filter_map(|x| Some((x, x.basis?, x.rate?, x.amount?)))
        .collect();
    if computable.is_empty() {
        skip(&mut r, "tax-amount", tax_title, no_data());
    } else {
        let findings = computable
            .into_iter()
            .filter(|(_, basis, rate, stated)| {
                (cents(basis * rate / 100.0) - cents(*stated)).abs() > ROUNDING_CENTS
            })
            .map(|(x, basis, rate, stated)| {
                let category = x.category.as_deref().unwrap_or("?");
                let expected = amount(cents(basis * rate / 100.0) / 100.0);
                let rate = plain(rate);
                c.pick(
                    format!(
                        "{category} {rate} %: {} ergibt {expected}, angegeben {}",
                        money(Some(basis)),
                        money(Some(stated))
                    ),
                    format!(
                        "{category} {rate} %: {} gives {expected}, stated {}",
                        money(Some(basis)),
                        money(Some(stated))
                    ),
                )
            })
            .collect();
        add(&mut r, "tax-amount", tax_title, findings, err);
    }

    // 9. Total tax
    let tax_sum_title = c.tr(
        "Gesamtsteuer = Summe der Steuerbeträge",
        "Total tax = sum of the tax amounts",
    );
    match t.tax_total {
        Some(tax_total)
            if !view.taxes.is_empty() && view.taxes.iter().all(|x| x.amount.is_some()) =>
        {
            let sum = total(view.taxes.iter().map(|x| cents(x.amount.unwrap_or(0.0))));
            let findings = if sum == cents(tax_total) {
                vec![]
            } else {
                vec![c.pick(
                    format!(
                        "Steuerbeträge ergeben {}, angegeben {}",
                        amount(sum / 100.0),
                        money(Some(tax_total))
                    ),
                    format!(
                        "Tax amounts add up to {}, stated {}",
                        amount(sum / 100.0),
                        money(Some(tax_total))
                    ),
                )]
            };
            add(&mut r, "tax-total", tax_sum_title, findings, err);
        }
        _ => skip(&mut r, "tax-total", tax_sum_title, no_data()),
    }

    // 10. Gross total
    let gross_title = c.tr(
        "Bruttosumme = Nettosumme + Steuer",
        "Gross total = net total + tax",
    );
    match (t.tax_basis, t.grand_total) {
        (Some(tax_basis), Some(grand_total)) => {
            let expected = cents(tax_basis) + cents(t.tax_total.unwrap_or(0.0));
            let findings = if expected == cents(grand_total) {
                vec![]
            } else {
                vec![c.pick(
                    format!(
                        "Ergibt {}, angegeben {}",
                        amount(expected / 100.0),
                        money(Some(grand_total))
                    ),
                    format!(
                        "Gives {}, stated {}",
                        amount(expected / 100.0),
                        money(Some(grand_total))
                    ),
                )]
            };
            add(&mut r, "gross-total", gross_title, findings, err);
        }
        _ => skip(&mut r, "gross-total", gross_title, no_data()),
    }

    // 11. Amount due
    let due_title = c.tr(
        "Zahlbetrag = Bruttosumme − Anzahlungen + Rundung",
        "Amount due = gross total − prepayments + rounding",
    );
    match (t.grand_total, t.due) {
        (Some(grand_total), Some(due)) => {
            let expected = cents(grand_total) - cents(t.prepaid.unwrap_or(0.0))
                + cents(t.rounding.unwrap_or(0.0));
            let findings = if expected == cents(due) {
                vec![]
            } else {
                vec![c.pick(
                    format!(
                        "Ergibt {}, angegeben {}",
                        amount(expected / 100.0),
                        money(Some(due))
                    ),
                    format!(
                        "Gives {}, stated {}",
                        amount(expected / 100.0),
                        money(Some(due))
                    ),
                )]
            };
            add(&mut r, "amount-due", due_title, findings, err);
        }
        _ => skip(&mut r, "amount-due", due_title, no_data()),
    }

    // 12. Tax categories
    let mut category: Vec<String> = Vec::new();
    for x in &view.taxes {
        let label = format!(
            "{} {} %",
            x.category.as_deref().unwrap_or("?"),
            x.rate.map_or("?".to_string(), plain)
        );
        match x.category.as_deref() {
            None => category.push(c.tr(
                "Eine Steueraufschlüsselung hat keine Kategorie",
                "A tax breakdown has no category",
            )),
            Some("S") if x.rate.unwrap_or(0.0) <= 0.0 => category.push(c.pick(
                format!("{label}: Regelsteuersatz (S) braucht einen Satz über 0"),
                format!("{label}: standard rate (S) needs a rate above 0"),
            )),
            Some(cat) if ZERO_RATE.contains(&cat) && x.rate.is_some_and(|rate| rate != 0.0) => {
                category.push(c.pick(
                    format!("{label}: Diese Kategorie verlangt 0 %"),
                    format!("{label}: this category requires 0 %"),
                ));
            }
            Some(_) => {}
        }
        if x.category
            .as_deref()
            .is_some_and(|cat| NEEDS_REASON.contains(&cat))
            && x.exemption_reason.is_none()
            && x.exemption_code.is_none()
        {
            category.push(c.pick(
                format!("{label}: Grund für die fehlende Steuer fehlt"),
                format!("{label}: reason for the missing tax is absent"),
            ));
        }
    }
    add(
        &mut r,
        "tax-category",
        c.tr(
            "Steuerkategorien passen zum Satz, Befreiungsgrund vorhanden",
            "Tax categories match the rate, exemption reason present",
        ),
        category,
        err,
    );

    // 13. Payment details
    let mut payment: Vec<String> = Vec::new();
    let owes = t.due.unwrap_or(0.0) > 0.0;
    if owes && view.payments.is_empty() {
        payment.push(c.tr(
            "Keine Zahlungsangaben (BG-16) trotz offenem Betrag",
            "No payment details (BG-16) although an amount is due",
        ));
    }
    for p in &view.payments {
        if let Some(iban) = p.iban.as_deref().filter(|i| !iban_ok(i)) {
            payment.push(c.pick(
                format!("IBAN {iban} hat eine falsche Prüfsumme"),
                format!("IBAN {iban} has a wrong checksum"),
            ));
        }
    }
    add(
        &mut r,
        "payment",
        c.tr(
            "Zahlungsangaben vorhanden, IBAN-Prüfsumme",
            "Payment details present, IBAN checksum",
        ),
        payment,
        Status::Warning,
    );

    // 14. Dates
    let mut dates: Vec<String> = Vec::new();
    let raw_dates = [
        (
            c.tr("Rechnungsdatum", "Issue date"),
            view.issue_date.as_deref(),
        ),
        (
            c.tr("Fälligkeitsdatum", "Due date"),
            view.due_date.as_deref(),
        ),
        (
            c.tr("Lieferdatum", "Delivery date"),
            view.delivery_date.as_deref(),
        ),
    ];
    for (label, value) in raw_dates {
        if let Some(value) = value.filter(|v| !real_date(Some(v))) {
            dates.push(c.pick(
                format!("{label} „{value}“ ist kein existierendes Datum"),
                format!("{label} \"{value}\" is not an existing date"),
            ));
        }
    }
    if let (Some(issue), Some(due)) = (view.issue_date.as_deref(), view.due_date.as_deref()) {
        if real_date(Some(issue)) && real_date(Some(due)) && due < issue {
            dates.push(c.tr(
                "Das Fälligkeitsdatum liegt vor dem Rechnungsdatum",
                "The due date is before the issue date",
            ));
        }
    }
    add(
        &mut r,
        "dates",
        c.tr(
            "Datumsangaben sind echte Kalendertage, Fälligkeit nicht vor Rechnungsdatum",
            "Dates are real calendar days, due date not before issue date",
        ),
        dates,
        Status::Warning,
    );

    r.extend(rule_checks(&c, view));

    r
}

/// What the check explicitly does NOT cover; returned next to the findings.
pub fn not_checked(lang: Lang) -> Vec<String> {
    let c = Ctx { lang };
    vec![
        c.tr(
            "Gültigkeit gegen das XML-Schema (XSD)",
            "Validity against the XML schema (XSD)",
        ),
        c.tr(
            "Die übrigen Geschäftsregeln der Norm EN 16931 (BR-…) und der XRechnung (BR-DE-…); geprüft wird nur die oben genannte Auswahl, nicht die Schematron-Regeln des KoSIT-Prüftools",
            "The remaining business rules of EN 16931 (BR-…) and XRechnung (BR-DE-…); only the selection named above is checked, not the Schematron rules of the KoSIT validator",
        ),
        c.tr(
            "Codelisten für Einheiten (UN/ECE Rec. 20: nur das Format) und Codes außerhalb der genannten Listen",
            "Code lists for units (UN/ECE Rec. 20: format only) and codes outside the listed ones",
        ),
        c.tr(
            "PDF/A-3-Konformität, XMP-Metadaten und ob das PDF zum XML passt",
            "PDF/A-3 conformity, XMP metadata and whether the PDF matches the XML",
        ),
        c.tr(
            "Echtheit, Signaturen und ob USt-IdNr., Steuersätze oder Bankverbindung stimmen",
            "Authenticity, signatures and whether VAT IDs, tax rates or bank details are correct",
        ),
    ]
}
