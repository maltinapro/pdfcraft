//! Amounts, display texts and the EN 16931 / XRechnung XML of an invoice.
//!
//! The Typst template only lays out what is computed here, so the printed
//! amounts and the embedded XML always agree and the template needs no
//! calculation code. Amounts are computed with fixed-point integers
//! (quantities and unit prices are rounded to 4 decimals, line totals and taxes
//! to cents, half away from zero), never with floats.

use crate::invoice::{escape, valid_date, Invoice, Item, Settings};
use serde_json::{json, Value};

const NBSP: &str = "\u{a0}";

struct Unit {
    key: &'static str,
    code: &'static str,
    de: (&'static str, &'static str),
    en: (&'static str, &'static str),
}

const UNITS: &[Unit] = &[
    Unit { key: "pcs", code: "H87", de: ("Stück", "Stück"), en: ("piece", "pieces") },
    Unit { key: "h", code: "HUR", de: ("Stunde", "Stunden"), en: ("hour", "hours") },
    Unit { key: "d", code: "DAY", de: ("Tag", "Tage"), en: ("day", "days") },
    Unit { key: "mo", code: "MON", de: ("Monat", "Monate"), en: ("month", "months") },
    Unit { key: "y", code: "ANN", de: ("Jahr", "Jahre"), en: ("year", "years") },
    Unit { key: "flat", code: "LS", de: ("Pauschale", "Pauschalen"), en: ("lump sum", "lump sums") },
    Unit { key: "kg", code: "KGM", de: ("Kilogramm", "Kilogramm"), en: ("kilogram", "kilograms") },
    Unit { key: "m", code: "MTR", de: ("Meter", "Meter"), en: ("metre", "metres") },
    Unit { key: "km", code: "KMT", de: ("Kilometer", "Kilometer"), en: ("kilometre", "kilometres") },
    Unit { key: "m2", code: "MTK", de: ("Quadratmeter", "Quadratmeter"), en: ("square metre", "square metres") },
    Unit { key: "l", code: "LTR", de: ("Liter", "Liter"), en: ("litre", "litres") },
];

// Electronic address scheme (EAS) of a VAT id, by its country prefix.
const VAT_EAS: &[(&str, &str)] = &[
    ("AT", "9914"), ("BE", "9925"), ("BG", "9926"), ("CH", "9927"), ("CY", "9928"),
    ("CZ", "9929"), ("DE", "9930"), ("EE", "9931"), ("EL", "9933"), ("ES", "9920"),
    ("FI", "0213"), ("FR", "9957"), ("GB", "9932"), ("GR", "9933"), ("HR", "9934"),
    ("HU", "9910"), ("IE", "9935"), ("IT", "0211"), ("LT", "9937"), ("LU", "9938"),
    ("LV", "9939"), ("MT", "9943"), ("NL", "9944"), ("PL", "9945"), ("PT", "9946"),
    ("RO", "9947"), ("SI", "9949"), ("SK", "9950"),
];

/// A decimal number with 4 decimals, stored as an integer (value * 10_000).
fn fixed(v: f64) -> i128 {
    (v * 10_000.0).round() as i128
}

fn div_round(n: i128, d: i128) -> i128 {
    let half = d / 2;
    if n >= 0 {
        (n + half) / d
    } else {
        -((-n + half) / d)
    }
}

fn group_thousands(int: &str) -> String {
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(c);
    }
    out
}

/// Formats a 4-decimal fixed-point value with at least `min` decimals.
fn decimal(v: i128, min: usize, comma: bool) -> String {
    let sign = if v < 0 { "-" } else { "" };
    let abs = v.abs();
    let mut frac = format!("{:04}", abs % 10_000);
    while frac.len() > min && frac.ends_with('0') {
        frac.pop();
    }
    let int = (abs / 10_000).to_string();
    if comma {
        let sep = if frac.is_empty() { "" } else { "," };
        format!("{sign}{}{sep}{frac}", group_thousands(&int))
    } else {
        let sep = if frac.is_empty() { "" } else { "." };
        format!("{sign}{int}{sep}{frac}")
    }
}

/// Cents (value * 100) as a German amount: `1.234,56`.
fn money(cents: i128) -> String {
    decimal(cents * 100, 2, true)
}

fn xml_amount(cents: i128) -> String {
    decimal(cents * 100, 2, false)
}

fn month_days(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        _ => 28,
    }
}

fn add_days((mut y, mut m, mut d): (i32, u32, u32), days: i64) -> (i32, u32, u32) {
    for _ in 0..days {
        d += 1;
        if d > month_days(y, m) {
            d = 1;
            m += 1;
            if m > 12 {
                m = 1;
                y += 1;
            }
        }
    }
    (y, m, d)
}

fn german_date((y, m, d): (i32, u32, u32)) -> String {
    format!("{d:02}.{m:02}.{y}")
}

fn xml_date((y, m, d): (i32, u32, u32)) -> String {
    format!("{y}{m:02}{d:02}")
}

fn xml_escape(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(*c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}'))
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn compact(s: &str) -> String {
    s.split_whitespace().collect()
}

fn iban_valid(iban: &str) -> bool {
    let b = iban.as_bytes();
    if !(15..=34).contains(&b.len())
        || !b[..2].iter().all(u8::is_ascii_uppercase)
        || !b[2..4].iter().all(u8::is_ascii_digit)
        || !b.iter().all(u8::is_ascii_alphanumeric)
    {
        return false;
    }
    let mut rem: u32 = 0;
    for &c in b[4..].iter().chain(b[..4].iter()) {
        let v = if c.is_ascii_digit() { (c - b'0') as u32 } else { (c - b'A') as u32 + 10 };
        rem = (rem * if v >= 10 { 100 } else { 10 } + v) % 97;
    }
    rem == 1
}

fn bic_valid(bic: &str) -> bool {
    matches!(bic.len(), 8 | 11)
        && bic.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && bic.bytes().take(6).all(|c| c.is_ascii_uppercase())
}

fn group_iban(iban: &str) -> String {
    iban.as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Splits `12345 Berlin` into the postcode and the city.
fn split_city(city: &str) -> (Option<&str>, &str) {
    match city.split_once(' ') {
        Some((code, rest)) if (4..=6).contains(&code.len()) && code.bytes().all(|c| c.is_ascii_digit()) => {
            (Some(code), rest.trim())
        }
        _ => (None, city),
    }
}

struct Line<'a> {
    item: &'a Item,
    unit: &'static Unit,
    qty: i128,
    price: i128,
    rate: i64,
    net: i128,
}

struct TaxGroup {
    rate: i64,
    basis: i128,
    tax: i128,
}

pub struct Xml {
    pub bytes: Vec<u8>,
    pub draft: bool,
    pub problems: Vec<String>,
}

pub struct Prepared {
    /// Extra top-level template data (`pay`, `einvoice`).
    pub extra: Value,
    pub xml: Option<Xml>,
}

fn element(out: &mut String, name: &str, text: &str) {
    out.push_str(&format!("<{name}>{}</{name}>", xml_escape(text)));
}

fn element_attr(out: &mut String, name: &str, attr: &str, value: &str, text: &str) {
    out.push_str(&format!("<{name} {attr}=\"{}\">{}</{name}>", xml_escape(value), xml_escape(text)));
}

fn open(out: &mut String, name: &str) {
    out.push_str(&format!("<{name}>"));
}

fn close(out: &mut String, name: &str) {
    out.push_str(&format!("</{name}>"));
}

fn date_element(out: &mut String, name: &str, date: (i32, u32, u32)) {
    open(out, name);
    element_attr(out, "udt:DateTimeString", "format", "102", &xml_date(date));
    close(out, name);
}

fn address(out: &mut String, street: &str, city: &str) {
    let (code, place) = split_city(city);
    open(out, "ram:PostalTradeAddress");
    if let Some(code) = code {
        element(out, "ram:PostcodeCode", code);
    }
    element(out, "ram:LineOne", street);
    element(out, "ram:CityName", place);
    element(out, "ram:CountryID", "DE");
    close(out, "ram:PostalTradeAddress");
}

/// The electronic address (BT-34, BT-49): derived from the VAT id, else the email.
fn electronic_address(vat_id: &str, email: &str) -> Option<(&'static str, String)> {
    let vat = compact(vat_id).to_uppercase();
    if vat.chars().count() > 2 {
        let prefix: String = vat.chars().take(2).collect();
        if let Some((_, scheme)) = VAT_EAS.iter().find(|(p, _)| *p == prefix) {
            return Some((scheme, vat));
        }
    }
    (!email.is_empty()).then(|| ("EM", email.to_string()))
}

fn electronic_address_element(out: &mut String, address: &Option<(&'static str, String)>) {
    if let Some((scheme, id)) = address {
        open(out, "ram:URIUniversalCommunication");
        element_attr(out, "ram:URIID", "schemeID", scheme, id);
        close(out, "ram:URIUniversalCommunication");
    }
}

/// Computes everything the template and the e-invoice need. `settings` is the
/// validated template data (defaults applied), `invoice_json` the validated
/// invoice data that gets its display texts added.
pub fn prepare(
    raw: &Settings,
    settings: &Value,
    inv: &Invoice,
    invoice_json: &mut Value,
) -> Prepared {
    let english = settings["locale"] == "en-de";
    let date = valid_date(&inv.date).unwrap_or((1970, 1, 1));
    let days = settings["paymentDays"].as_i64().unwrap_or(14);
    let due = add_days(date, days);
    let reason = raw.exemption_reason.as_deref().unwrap_or("Steuerfrei nach § 4 UStG").trim();

    let lines: Vec<Line> = inv
        .items
        .iter()
        .map(|item| {
            let key = item.unit.as_deref().unwrap_or("pcs");
            let unit = UNITS.iter().find(|u| u.key == key).unwrap_or(&UNITS[0]);
            let (qty, price) = (fixed(item.quantity), fixed(item.price));
            Line {
                item,
                unit,
                qty,
                price,
                rate: item.tax_rate.unwrap_or(19.0) as i64,
                net: div_round(qty * price, 1_000_000),
            }
        })
        .collect();

    let mut groups: Vec<TaxGroup> = Vec::new();
    for line in &lines {
        match groups.iter_mut().find(|g| g.rate == line.rate) {
            Some(g) => g.basis += line.net,
            None => groups.push(TaxGroup { rate: line.rate, basis: line.net, tax: 0 }),
        }
    }
    for g in &mut groups {
        g.tax = div_round(g.basis * g.rate as i128, 100);
    }
    let net: i128 = lines.iter().map(|l| l.net).sum();
    let tax: i128 = groups.iter().map(|g| g.tax).sum();
    let gross = net + tax;
    let has_exempt = groups.iter().any(|g| g.rate == 0);
    let category = |rate: i64| if rate == 0 { "E" } else { "S" };

    if let Some(items) = invoice_json["items"].as_array_mut() {
        for (i, (item, line)) in items.iter_mut().zip(&lines).enumerate() {
            let unit = if line.qty == 10_000 {
                if english { line.unit.en.0 } else { line.unit.de.0 }
            } else if english {
                line.unit.en.1
            } else {
                line.unit.de.1
            };
            item["pos"] = json!((i + 1).to_string());
            item["qty"] = json!(format!("{}{NBSP}{unit}", decimal(line.qty, 0, true)));
            item["price"] = json!(format!("{}{NBSP}€", decimal(line.price, 2, true)));
            item["tax"] = json!(format!("{}% {}", line.rate, category(line.rate)));
            item["net"] = json!(format!("{}{NBSP}€", money(line.net)));
        }
    }
    invoice_json["dateText"] = json!(german_date(date));
    invoice_json["totals"] = json!({
        "net": format!("{}{NBSP}€", money(net)),
        "gross": format!("{}{NBSP}€", money(gross)),
        "taxes": groups.iter().filter(|g| g.rate != 0).map(|g| json!({
            "rate": format!("{}%", g.rate),
            "cat": category(g.rate),
            "amount": format!("{}{NBSP}€", money(g.tax)),
        })).collect::<Vec<_>>(),
        "exempt": has_exempt,
    });

    let sender = &raw.sender;
    let bank = &raw.bank;
    let iban = compact(&bank.iban).to_uppercase();
    let bic = compact(&bank.bic).to_uppercase();
    let holder = sender.name.trim();
    let number = inv.number.trim();
    let qr = iban_valid(&iban)
        && holder.len() <= 70
        && number.len() <= 140
        && (bic.is_empty() || bic_valid(&bic));
    let qr_amount = (1..=99_999_999_999).contains(&gross).then(|| gross as f64 / 100.0);
    let mut extra = json!({
        "pay": {
            "sum": format!("{}{NBSP}€", money(gross)),
            "days": days,
            "iban": escape(&group_iban(&iban)),
            "ibanRaw": escape(&iban),
            "bic": escape(&bic),
            "qr": qr,
            "amount": qr_amount,
            "place": escape(split_city(sender.city.trim()).1),
        },
    });

    if !settings["zugferd"].as_bool().unwrap_or(true) {
        return Prepared { extra, xml: None };
    }

    let xrechnung = settings["einvoiceProfile"] == "xrechnung";
    let sender_vat = compact(&sender.vat_id).to_uppercase();
    let sender_tax_nr = sender.tax_nr.trim();
    let sender_email = sender.email.trim();
    let sender_phone = sender.phone.trim();
    let contact = sender.contact_name.trim();
    let recipient = &inv.recipient;
    let buyer_vat = compact(&recipient.vat_id).to_uppercase();
    let buyer_email = recipient.email.trim();
    let buyer_ref = recipient.buyer_reference.trim();
    let seller_address = electronic_address(&sender_vat, sender_email);
    let buyer_address = electronic_address(&buyer_vat, buyer_email);

    let mut problems: Vec<String> = Vec::new();
    if sender_vat.is_empty() && sender_tax_nr.is_empty() {
        problems.push("seller VAT id or tax number is missing (BR-S-02, BR-E-02)".into());
    }
    if has_exempt && reason.is_empty() {
        problems.push("exemption reason is missing (BR-E-10)".into());
    }
    if lines.iter().any(|l| l.price < 0) {
        problems.push("unit prices must not be negative (BR-27)".into());
    }
    if iban.is_empty() {
        if xrechnung {
            problems.push("payment instructions (IBAN) are missing (BR-DE-1)".into());
        }
    } else if !iban_valid(&iban) {
        problems.push("the IBAN is not valid".into());
    }
    if !bic.is_empty() && !bic_valid(&bic) {
        problems.push("the BIC is not valid".into());
    }
    if xrechnung {
        if contact.is_empty() {
            problems.push("seller contact name is missing (BR-DE-5)".into());
        }
        if sender_phone.is_empty() {
            problems.push("seller contact phone is missing (BR-DE-6)".into());
        }
        if sender_email.is_empty() {
            problems.push("seller contact email is missing (BR-DE-7)".into());
        }
        if buyer_ref.is_empty() {
            problems.push("buyer reference is missing (BR-DE-15)".into());
        }
        if seller_address.is_none() {
            problems.push("seller electronic address is missing (PEPPOL-EN16931-R020)".into());
        }
        if buyer_address.is_none() {
            problems.push("buyer electronic address is missing (PEPPOL-EN16931-R010)".into());
        }
        if split_city(sender.city.trim()).0.is_none() {
            problems.push("seller postcode is missing (BR-DE-4)".into());
        }
        if split_city(recipient.city.trim()).0.is_none() {
            problems.push("buyer postcode is missing (BR-DE-8)".into());
        }
    }

    let mut x = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    x.push_str("<rsm:CrossIndustryInvoice xmlns:rsm=\"urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100\" xmlns:qdt=\"urn:un:unece:uncefact:data:standard:QualifiedDataType:100\" xmlns:ram=\"urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100\" xmlns:udt=\"urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">");
    open(&mut x, "rsm:ExchangedDocumentContext");
    open(&mut x, "ram:BusinessProcessSpecifiedDocumentContextParameter");
    element(&mut x, "ram:ID", "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0");
    close(&mut x, "ram:BusinessProcessSpecifiedDocumentContextParameter");
    open(&mut x, "ram:GuidelineSpecifiedDocumentContextParameter");
    element(
        &mut x,
        "ram:ID",
        if xrechnung {
            "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
        } else {
            "urn:cen.eu:en16931:2017"
        },
    );
    close(&mut x, "ram:GuidelineSpecifiedDocumentContextParameter");
    close(&mut x, "rsm:ExchangedDocumentContext");

    open(&mut x, "rsm:ExchangedDocument");
    element(&mut x, "ram:ID", number);
    element(&mut x, "ram:TypeCode", "380");
    date_element(&mut x, "ram:IssueDateTime", date);
    close(&mut x, "rsm:ExchangedDocument");

    open(&mut x, "rsm:SupplyChainTradeTransaction");
    for (i, line) in lines.iter().enumerate() {
        open(&mut x, "ram:IncludedSupplyChainTradeLineItem");
        open(&mut x, "ram:AssociatedDocumentLineDocument");
        element(&mut x, "ram:LineID", &(i + 1).to_string());
        close(&mut x, "ram:AssociatedDocumentLineDocument");
        open(&mut x, "ram:SpecifiedTradeProduct");
        element(&mut x, "ram:Name", &line.item.description.trim().replace(['\r', '\n'], " "));
        close(&mut x, "ram:SpecifiedTradeProduct");
        open(&mut x, "ram:SpecifiedLineTradeAgreement");
        open(&mut x, "ram:NetPriceProductTradePrice");
        element(&mut x, "ram:ChargeAmount", &decimal(line.price, 2, false));
        close(&mut x, "ram:NetPriceProductTradePrice");
        close(&mut x, "ram:SpecifiedLineTradeAgreement");
        open(&mut x, "ram:SpecifiedLineTradeDelivery");
        element_attr(&mut x, "ram:BilledQuantity", "unitCode", line.unit.code, &decimal(line.qty, 2, false));
        close(&mut x, "ram:SpecifiedLineTradeDelivery");
        open(&mut x, "ram:SpecifiedLineTradeSettlement");
        open(&mut x, "ram:ApplicableTradeTax");
        element(&mut x, "ram:TypeCode", "VAT");
        element(&mut x, "ram:CategoryCode", category(line.rate));
        element(&mut x, "ram:RateApplicablePercent", &format!("{}.00", line.rate));
        close(&mut x, "ram:ApplicableTradeTax");
        open(&mut x, "ram:SpecifiedTradeSettlementLineMonetarySummation");
        element(&mut x, "ram:LineTotalAmount", &xml_amount(line.net));
        close(&mut x, "ram:SpecifiedTradeSettlementLineMonetarySummation");
        close(&mut x, "ram:SpecifiedLineTradeSettlement");
        close(&mut x, "ram:IncludedSupplyChainTradeLineItem");
    }

    open(&mut x, "ram:ApplicableHeaderTradeAgreement");
    if !buyer_ref.is_empty() {
        element(&mut x, "ram:BuyerReference", buyer_ref);
    }
    open(&mut x, "ram:SellerTradeParty");
    element(&mut x, "ram:Name", sender.name.trim());
    if !contact.is_empty() || !sender_phone.is_empty() || !sender_email.is_empty() {
        open(&mut x, "ram:DefinedTradeContact");
        if !contact.is_empty() {
            element(&mut x, "ram:PersonName", contact);
        }
        if !sender_phone.is_empty() {
            open(&mut x, "ram:TelephoneUniversalCommunication");
            element(&mut x, "ram:CompleteNumber", sender_phone);
            close(&mut x, "ram:TelephoneUniversalCommunication");
        }
        if !sender_email.is_empty() {
            open(&mut x, "ram:EmailURIUniversalCommunication");
            element(&mut x, "ram:URIID", sender_email);
            close(&mut x, "ram:EmailURIUniversalCommunication");
        }
        close(&mut x, "ram:DefinedTradeContact");
    }
    address(&mut x, sender.address.trim(), sender.city.trim());
    electronic_address_element(&mut x, &seller_address);
    for (scheme, id) in [("VA", sender_vat.as_str()), ("FC", sender_tax_nr)] {
        if !id.is_empty() {
            open(&mut x, "ram:SpecifiedTaxRegistration");
            element_attr(&mut x, "ram:ID", "schemeID", scheme, id);
            close(&mut x, "ram:SpecifiedTaxRegistration");
        }
    }
    close(&mut x, "ram:SellerTradeParty");
    open(&mut x, "ram:BuyerTradeParty");
    element(&mut x, "ram:Name", recipient.name.trim());
    address(&mut x, recipient.address.trim(), recipient.city.trim());
    electronic_address_element(&mut x, &buyer_address);
    if !buyer_vat.is_empty() {
        open(&mut x, "ram:SpecifiedTaxRegistration");
        element_attr(&mut x, "ram:ID", "schemeID", "VA", &buyer_vat);
        close(&mut x, "ram:SpecifiedTaxRegistration");
    }
    close(&mut x, "ram:BuyerTradeParty");
    close(&mut x, "ram:ApplicableHeaderTradeAgreement");

    open(&mut x, "ram:ApplicableHeaderTradeDelivery");
    open(&mut x, "ram:ActualDeliverySupplyChainEvent");
    date_element(&mut x, "ram:OccurrenceDateTime", date);
    close(&mut x, "ram:ActualDeliverySupplyChainEvent");
    close(&mut x, "ram:ApplicableHeaderTradeDelivery");

    open(&mut x, "ram:ApplicableHeaderTradeSettlement");
    element(&mut x, "ram:PaymentReference", number);
    element(&mut x, "ram:InvoiceCurrencyCode", "EUR");
    open(&mut x, "ram:SpecifiedTradeSettlementPaymentMeans");
    element(&mut x, "ram:TypeCode", if iban.is_empty() { "1" } else { "58" });
    if !iban.is_empty() {
        open(&mut x, "ram:PayeePartyCreditorFinancialAccount");
        element(&mut x, "ram:IBANID", &iban);
        close(&mut x, "ram:PayeePartyCreditorFinancialAccount");
        if !bic.is_empty() {
            open(&mut x, "ram:PayeeSpecifiedCreditorFinancialInstitution");
            element(&mut x, "ram:BICID", &bic);
            close(&mut x, "ram:PayeeSpecifiedCreditorFinancialInstitution");
        }
    }
    close(&mut x, "ram:SpecifiedTradeSettlementPaymentMeans");
    for g in &groups {
        open(&mut x, "ram:ApplicableTradeTax");
        element(&mut x, "ram:CalculatedAmount", &xml_amount(g.tax));
        element(&mut x, "ram:TypeCode", "VAT");
        if g.rate == 0 {
            element(&mut x, "ram:ExemptionReason", reason);
        }
        element(&mut x, "ram:BasisAmount", &xml_amount(g.basis));
        element(&mut x, "ram:CategoryCode", category(g.rate));
        element(&mut x, "ram:RateApplicablePercent", &format!("{}.00", g.rate));
        close(&mut x, "ram:ApplicableTradeTax");
    }
    open(&mut x, "ram:SpecifiedTradePaymentTerms");
    date_element(&mut x, "ram:DueDateDateTime", due);
    close(&mut x, "ram:SpecifiedTradePaymentTerms");
    open(&mut x, "ram:SpecifiedTradeSettlementHeaderMonetarySummation");
    element(&mut x, "ram:LineTotalAmount", &xml_amount(net));
    element(&mut x, "ram:TaxBasisTotalAmount", &xml_amount(net));
    element_attr(&mut x, "ram:TaxTotalAmount", "currencyID", "EUR", &xml_amount(tax));
    element(&mut x, "ram:GrandTotalAmount", &xml_amount(gross));
    element(&mut x, "ram:DuePayableAmount", &xml_amount(gross));
    close(&mut x, "ram:SpecifiedTradeSettlementHeaderMonetarySummation");
    close(&mut x, "ram:ApplicableHeaderTradeSettlement");
    close(&mut x, "rsm:SupplyChainTradeTransaction");
    close(&mut x, "rsm:CrossIndustryInvoice");

    let draft = !problems.is_empty();
    let (file, relationship, description) = if draft {
        (
            "invoice-draft.xml",
            "data",
            "Draft of the ZUGFeRD / Factur-X invoice data with errors, not a valid e-invoice",
        )
    } else if xrechnung {
        ("xrechnung.xml", "alternative", "XRechnung 3.0 invoice data (EN 16931)")
    } else {
        ("factur-x.xml", "alternative", "ZUGFeRD / Factur-X invoice data (EN 16931)")
    };
    extra["einvoice"] = json!({ "file": file, "relationship": relationship, "description": description });
    Prepared {
        extra,
        xml: Some(Xml { bytes: x.into_bytes(), draft, problems }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_half_away_from_zero() {
        assert_eq!(money(div_round(fixed(1.5) * fixed(9.99), 10_000 * 100)), "14,99");
    }

    #[test]
    fn formats_amounts() {
        assert_eq!(xml_amount(1_234_567), "12345.67");
        assert_eq!(group_thousands("1234567"), "1.234.567");
    }

    #[test]
    fn validates_iban_and_bic() {
        assert!(iban_valid("DE89370400440532013000"));
        assert!(!iban_valid("DE89370400440532013001"));
        assert!(bic_valid("COBADEFFXXX"));
        assert!(!bic_valid("X"));
    }

    #[test]
    fn adds_days_across_months() {
        assert_eq!(add_days((2026, 1, 15), 30), (2026, 2, 14));
        assert_eq!(add_days((2026, 12, 20), 14), (2027, 1, 3));
    }

    #[test]
    fn escapes_xml() {
        assert_eq!(xml_escape("a&b<c>\"d\""), "a&amp;b&lt;c&gt;&quot;d&quot;");
    }
}
