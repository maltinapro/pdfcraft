//! A native subset of the EN 16931 and XRechnung business rules and code lists that can be decided from the
//! normalized view alone, a port of `frontend/src/lib/einvoice/rules.ts`. It is NOT the Schematron validation
//! of the KoSIT validator or Mustang (see `check::not_checked`); every finding names the rule id of the
//! official rule set.

use super::check::{iban_ok, CheckResult, Ctx, Status};
use super::view::InvoiceView;

/// ISO 3166-1 alpha-2 plus `1A` (Kosovo), the EN 16931 country code list (BR-CL-14).
const COUNTRIES: &str = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW 1A";

/// ISO 4217 alpha-3 currency codes in use (BR-CL-03).
const CURRENCIES: &str = "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG";

/// UNTDID 1001 document types allowed by EN 16931 (BR-CL-01).
const TYPE_CODES: &str = "71 79 80 82 84 102 218 219 326 331 332 351 380 381 382 383 384 385 386 387 388 389 390 393 394 395 396 420 456 457 458 527 575 623 633 751 780 817 870 875 876 877 935";
/// Document types allowed by the XRechnung (BR-DE-17).
const XRECHNUNG_TYPE_CODES: &str = "326 380 381 384 389 875 876 877";
/// UNCL 5305 VAT categories (BR-CL-17/18).
const TAX_CATEGORIES: &str = "AE E S Z G O K L M";
/// Categories for which the seller needs a VAT or tax number (BR-DE-16).
const SELLER_TAX_ID: &str = "S Z E AE K G L M";

fn listed(list: &str, code: &str) -> bool {
    list.split(' ').any(|c| c == code)
}

/// UNTDID 4461 payment means (BR-CL-16): 1-68, 70, 74-78, 91-97, ZZ.
fn payment_means_known(code: &str) -> bool {
    if code == "ZZ" {
        return true;
    }
    if code.is_empty() || code.len() > 2 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let n: u32 = code.parse().unwrap_or(0);
    (1..=68).contains(&n) || n == 70 || (74..=78).contains(&n) || (91..=97).contains(&n)
}

fn is_xrechnung(view: &InvoiceView) -> bool {
    let p = view.profile.as_deref().unwrap_or("").to_lowercase();
    p.contains("xrechnung") || p.contains("xeinkauf.de")
}

/// Findings are kept in order and deduplicated; each starts with the rule id.
#[derive(Default)]
struct Findings(Vec<String>);

impl Findings {
    fn add(&mut self, c: &Ctx, rule: &str, de: &str, en: &str) {
        self.add_text(rule, c.tr(de, en));
    }

    fn add_text(&mut self, rule: &str, text: String) {
        let text = format!("{rule}: {text}");
        if !self.0.contains(&text) {
            self.0.push(text);
        }
    }
}

fn result(id: &str, title: String, f: Findings) -> CheckResult {
    CheckResult {
        id: id.to_string(),
        title,
        status: if f.0.is_empty() {
            Status::Ok
        } else {
            Status::Error
        },
        findings: f.0,
    }
}

fn used_categories(view: &InvoiceView) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let all = view
        .items
        .iter()
        .map(|l| l.tax_category.as_ref())
        .chain(view.adjustments.iter().map(|a| a.tax_category.as_ref()));
    for category in all.flatten() {
        if !category.is_empty() && !out.contains(category) {
            out.push(category.clone());
        }
    }
    out
}

fn email_ok(raw: &str) -> bool {
    let email = raw.trim();
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    if local.is_empty() || domain.contains('@') || email.chars().any(char::is_whitespace) {
        return false;
    }
    match domain.rfind('.') {
        Some(pos) => pos >= 1 && pos < domain.len() - 1,
        None => false,
    }
}

/// A text field that is missing or empty (JS truthiness in the TypeScript original).
fn absent(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(str::is_empty)
}

/// More than two decimal places (BR-DEC-*); read from the parsed number, so trailing zeros do not count.
fn too_many_decimals(value: Option<f64>) -> bool {
    let Some(value) = value else { return false };
    let scaled = value.abs() * 100.0;
    (scaled - scaled.round()).abs() > (1e-6_f64).max(scaled * 1e-12)
}

pub(super) fn en16931_rules(c: &Ctx, view: &InvoiceView) -> CheckResult {
    let mut f = Findings::default();
    let t = &view.totals;

    if view.items.is_empty() {
        f.add(
            c,
            "BR-16",
            "Die Rechnung braucht mindestens eine Position (BG-25)",
            "The invoice needs at least one line (BG-25)",
        );
    }
    for (i, line) in view.items.iter().enumerate() {
        let n = c.line_label(line, i);
        let mut line_rule = |rule: &str, de: &str, en: &str| {
            f.add_text(rule, c.pick(format!("{n}: {de}"), format!("{n}: {en}")));
        };
        if absent(&line.id) {
            line_rule(
                "BR-21",
                "Positionskennung (BT-126) fehlt",
                "line identifier (BT-126) is missing",
            );
        }
        if line.quantity.is_none() {
            line_rule(
                "BR-22",
                "Menge (BT-129) fehlt",
                "quantity (BT-129) is missing",
            );
        }
        if absent(&line.unit) {
            line_rule(
                "BR-23",
                "Mengeneinheit (BT-130) fehlt",
                "unit of measure (BT-130) is missing",
            );
        }
        if line.net.is_none() {
            line_rule(
                "BR-24",
                "Nettobetrag (BT-131) fehlt",
                "line net amount (BT-131) is missing",
            );
        }
        if absent(&line.name) {
            line_rule(
                "BR-25",
                "Bezeichnung (BT-153) fehlt",
                "item name (BT-153) is missing",
            );
        }
        if line.price.is_none() {
            line_rule(
                "BR-26",
                "Nettopreis (BT-146) fehlt",
                "net price (BT-146) is missing",
            );
        }
        if line.price.is_some_and(|p| p < 0.0) {
            line_rule(
                "BR-27",
                "Der Nettopreis (BT-146) ist negativ",
                "the net price (BT-146) is negative",
            );
        }
        if absent(&line.tax_category) {
            line_rule(
                "BR-CO-04",
                "Steuerkategorie (BT-151) fehlt",
                "VAT category (BT-151) is missing",
            );
        }
        if too_many_decimals(line.net) {
            line_rule(
                "BR-DEC-23",
                "Nettobetrag (BT-131) hat mehr als zwei Nachkommastellen",
                "line net amount (BT-131) has more than two decimal places",
            );
        }
    }

    for (i, a) in view.adjustments.iter().enumerate() {
        let (de, en, amount_rule, category_rule, dec_rule) = if a.charge {
            ("Zuschlag", "Charge", "BR-36", "BR-37", "BR-DEC-05")
        } else {
            ("Nachlass", "Allowance", "BR-31", "BR-32", "BR-DEC-01")
        };
        let n = i + 1;
        if a.amount.is_none() {
            f.add_text(
                amount_rule,
                c.pick(
                    format!("{de} {n}: Betrag fehlt"),
                    format!("{en} {n}: amount is missing"),
                ),
            );
        }
        if absent(&a.tax_category) {
            f.add_text(
                category_rule,
                c.pick(
                    format!("{de} {n}: USt-Kategorie fehlt"),
                    format!("{en} {n}: VAT category is missing"),
                ),
            );
        }
        if too_many_decimals(a.amount) {
            f.add_text(
                dec_rule,
                c.pick(
                    format!("{de} {n}: Betrag hat mehr als zwei Nachkommastellen"),
                    format!("{en} {n}: amount has more than two decimal places"),
                ),
            );
        }
    }

    for x in &view.taxes {
        let label = x.category.clone().unwrap_or_else(|| "?".to_string());
        if x.basis.is_none() {
            f.add_text(
                "BR-45",
                c.pick(
                    format!("{label}: Steuerbemessungsgrundlage (BT-116) fehlt"),
                    format!("{label}: VAT category taxable amount (BT-116) is missing"),
                ),
            );
        }
        if x.amount.is_none() {
            f.add_text(
                "BR-46",
                c.pick(
                    format!("{label}: Steuerbetrag (BT-117) fehlt"),
                    format!("{label}: VAT category tax amount (BT-117) is missing"),
                ),
            );
        }
        if absent(&x.category) {
            f.add(
                c,
                "BR-47",
                "Eine Steueraufschlüsselung hat keinen Kategoriecode (BT-118)",
                "A VAT breakdown has no category code (BT-118)",
            );
        }
        if x.rate.is_none() && x.category.as_deref() != Some("O") {
            f.add_text(
                "BR-48",
                c.pick(
                    format!("{label}: Steuersatz (BT-119) fehlt"),
                    format!("{label}: VAT category rate (BT-119) is missing"),
                ),
            );
        }
        if too_many_decimals(x.basis) {
            f.add_text("BR-DEC-19", c.pick(format!("{label}: Steuerbemessungsgrundlage (BT-116) hat mehr als zwei Nachkommastellen"), format!("{label}: VAT category taxable amount (BT-116) has more than two decimal places")));
        }
        if too_many_decimals(x.amount) {
            f.add_text("BR-DEC-20", c.pick(format!("{label}: Steuerbetrag (BT-117) hat mehr als zwei Nachkommastellen"), format!("{label}: VAT category tax amount (BT-117) has more than two decimal places")));
        }
    }

    let mandatory = [
        (
            t.line_total,
            "BR-12",
            "Summe der Positionsbeträge (BT-106)",
            "Sum of invoice line net amounts (BT-106)",
            "BR-DEC-09",
        ),
        (
            t.tax_basis,
            "BR-13",
            "Gesamtsumme ohne USt (BT-109)",
            "Invoice total amount without VAT (BT-109)",
            "BR-DEC-12",
        ),
        (
            t.grand_total,
            "BR-14",
            "Gesamtsumme mit USt (BT-112)",
            "Invoice total amount with VAT (BT-112)",
            "BR-DEC-14",
        ),
        (
            t.due,
            "BR-15",
            "Zahlbetrag (BT-115)",
            "Amount due for payment (BT-115)",
            "BR-DEC-18",
        ),
    ];
    for (value, rule, de, en, dec_rule) in mandatory {
        if value.is_none() {
            f.add_text(
                rule,
                c.pick(format!("{de} fehlt"), format!("{en} is missing")),
            );
        }
        if too_many_decimals(value) {
            f.add_text(
                dec_rule,
                c.pick(
                    format!("{de} hat mehr als zwei Nachkommastellen"),
                    format!("{en} has more than two decimal places"),
                ),
            );
        }
    }
    let optional = [
        (
            t.allowance_total,
            "BR-DEC-10",
            "Summe der Nachlässe (BT-107)",
            "Sum of allowances on document level (BT-107)",
        ),
        (
            t.charge_total,
            "BR-DEC-11",
            "Summe der Zuschläge (BT-108)",
            "Sum of charges on document level (BT-108)",
        ),
        (
            t.tax_total,
            "BR-DEC-13",
            "Gesamtsumme USt (BT-110)",
            "Invoice total VAT amount (BT-110)",
        ),
        (
            t.prepaid,
            "BR-DEC-16",
            "Gezahlter Betrag (BT-113)",
            "Paid amount (BT-113)",
        ),
        (
            t.rounding,
            "BR-DEC-17",
            "Rundungsbetrag (BT-114)",
            "Rounding amount (BT-114)",
        ),
    ];
    for (value, rule, de, en) in optional {
        if too_many_decimals(value) {
            f.add_text(
                rule,
                c.pick(
                    format!("{de} hat mehr als zwei Nachkommastellen"),
                    format!("{en} has more than two decimal places"),
                ),
            );
        }
    }

    let vat_prefix = |f: &mut Findings, who: &str, who_en: &str, id: Option<&String>| {
        let Some(id) = id else { return };
        let prefix: String = id.trim().chars().take(2).collect::<String>().to_uppercase();
        if !(listed(COUNTRIES, &prefix) || prefix == "EL" || prefix == "XI") {
            f.add_text(
                "BR-CO-9",
                c.pick(
                    format!("USt-IdNr. {who} „{id}“ beginnt nicht mit einem Ländercode (ISO 3166-1 alpha-2)"),
                    format!("{who_en} VAT ID \"{id}\" does not start with a country code (ISO 3166-1 alpha-2)"),
                ),
            );
        }
    };
    vat_prefix(
        &mut f,
        "des Verkäufers",
        "Seller",
        view.seller.vat_id.as_ref(),
    );
    vat_prefix(&mut f, "des Käufers", "Buyer", view.buyer.vat_id.as_ref());

    if view.taxes.is_empty() {
        f.add(
            c,
            "BR-CO-18",
            "Die Rechnung braucht mindestens eine Steueraufschlüsselung (BG-23)",
            "The invoice needs at least one VAT breakdown (BG-23)",
        );
    }
    if t.due.unwrap_or(0.0) > 0.0 && view.due_date.is_none() && view.payment_terms.is_none() {
        f.add(
            c,
            "BR-CO-25",
            "Es ist ein Betrag offen, aber weder Fälligkeitsdatum (BT-9) noch Zahlungsbedingungen (BT-20) sind angegeben",
            "An amount is due but neither due date (BT-9) nor payment terms (BT-20) are given",
        );
    }
    for p in &view.payments {
        if matches!(p.code.as_deref(), Some("30" | "58")) && p.iban.is_none() {
            f.add(
                c,
                "BR-61",
                "Bei Überweisung (Zahlungsart 30/58) fehlt die Kontonummer bzw. IBAN (BT-84)",
                "For a credit transfer (payment means 30/58) the account identifier / IBAN (BT-84) is missing",
            );
        }
    }

    let seller_tax_id = view.seller.vat_id.is_some() || view.seller.tax_number.is_some();
    let buyer_id = view.buyer.vat_id.is_some() || view.buyer.registration.is_some();
    for category in used_categories(view) {
        let category = category.as_str();
        let rule = match category {
            "S" => Some("BR-S-02"),
            "Z" => Some("BR-Z-02"),
            "E" => Some("BR-E-02"),
            "L" => Some("BR-IG-02"),
            "M" => Some("BR-IP-02"),
            _ => None,
        };
        if let Some(rule) = rule {
            if !seller_tax_id {
                f.add_text(
                    rule,
                    c.pick(
                        format!("Kategorie {category}: USt-IdNr. oder Steuernummer des Verkäufers fehlt"),
                        format!("Category {category}: seller VAT ID or tax number is missing"),
                    ),
                );
            }
        }
        match category {
            "G" if view.seller.vat_id.is_none() => f.add(
                c,
                "BR-G-02",
                "Kategorie G: USt-IdNr. des Verkäufers fehlt",
                "Category G: seller VAT ID is missing",
            ),
            "AE" => {
                if !seller_tax_id {
                    f.add(
                        c,
                        "BR-AE-02",
                        "Kategorie AE: USt-IdNr. oder Steuernummer des Verkäufers fehlt",
                        "Category AE: seller VAT ID or tax number is missing",
                    );
                }
                if !buyer_id {
                    f.add(
                        c,
                        "BR-AE-02",
                        "Kategorie AE: USt-IdNr. oder Registerkennung des Käufers fehlt",
                        "Category AE: buyer VAT ID or legal registration identifier is missing",
                    );
                }
            }
            "K" => {
                if view.seller.vat_id.is_none() {
                    f.add(
                        c,
                        "BR-IC-02",
                        "Kategorie K: USt-IdNr. des Verkäufers fehlt",
                        "Category K: seller VAT ID is missing",
                    );
                }
                if view.buyer.vat_id.is_none() {
                    f.add(
                        c,
                        "BR-IC-02",
                        "Kategorie K: USt-IdNr. des Käufers fehlt",
                        "Category K: buyer VAT ID is missing",
                    );
                }
            }
            "O" if view.seller.vat_id.is_some() || view.buyer.vat_id.is_some() => f.add(
                c,
                "BR-O-02",
                "Kategorie O (nicht steuerbar): USt-IdNr. von Verkäufer und Käufer dürfen nicht angegeben sein",
                "Category O (not subject to VAT): seller and buyer VAT IDs must not be given",
            ),
            _ => {}
        }
    }

    result(
        "en16931-rules",
        c.tr(
            "Geschäftsregeln der EN 16931 (Auswahl: Pflichtfelder, Nachkommastellen BR-DEC, BR-27, BR-61, BR-CO-9/18/25, kategoriebezogene Regeln)",
            "EN 16931 business rules (selection: mandatory fields, decimal places BR-DEC, BR-27, BR-61, BR-CO-9/18/25, category rules)",
        ),
        f,
    )
}

pub(super) fn xrechnung_rules(c: &Ctx, view: &InvoiceView) -> Option<CheckResult> {
    if !is_xrechnung(view) {
        return None;
    }
    let mut f = Findings::default();
    let s = &view.seller;
    let b = &view.buyer;

    if view.payments.is_empty() {
        f.add(
            c,
            "BR-DE-1",
            "Zahlungsangaben (BG-16) fehlen",
            "Payment instructions (BG-16) are missing",
        );
    }
    if s.city.is_none() {
        f.add(
            c,
            "BR-DE-3",
            "Ort des Verkäufers (BT-37) fehlt",
            "Seller city (BT-37) is missing",
        );
    }
    if s.postcode.is_none() {
        f.add(
            c,
            "BR-DE-4",
            "Postleitzahl des Verkäufers (BT-38) fehlt",
            "Seller post code (BT-38) is missing",
        );
    }
    if s.contact_name.is_none() {
        f.add(
            c,
            "BR-DE-5",
            "Ansprechpartner des Verkäufers (BT-41) fehlt",
            "Seller contact name (BT-41) is missing",
        );
    }
    match &s.phone {
        None => f.add(
            c,
            "BR-DE-6",
            "Telefonnummer des Verkäufers (BT-42) fehlt",
            "Seller telephone number (BT-42) is missing",
        ),
        Some(phone) if phone.bytes().filter(u8::is_ascii_digit).count() < 3 => f.add(
            c,
            "BR-DE-27",
            "Die Telefonnummer des Verkäufers (BT-42) braucht mindestens drei Ziffern",
            "The seller telephone number (BT-42) needs at least three digits",
        ),
        Some(_) => {}
    }
    match &s.email {
        None => f.add(
            c,
            "BR-DE-7",
            "E-Mail des Verkäufers (BT-43) fehlt",
            "Seller email (BT-43) is missing",
        ),
        Some(email) if !email_ok(email) => f.add(
            c,
            "BR-DE-28",
            "Die E-Mail des Verkäufers (BT-43) sieht nicht wie eine E-Mail-Adresse aus",
            "The seller email (BT-43) does not look like an email address",
        ),
        Some(_) => {}
    }
    if b.city.is_none() {
        f.add(
            c,
            "BR-DE-8",
            "Ort des Käufers (BT-52) fehlt",
            "Buyer city (BT-52) is missing",
        );
    }
    if b.postcode.is_none() {
        f.add(
            c,
            "BR-DE-9",
            "Postleitzahl des Käufers (BT-53) fehlt",
            "Buyer post code (BT-53) is missing",
        );
    }
    if view.buyer_reference.is_none() {
        f.add(
            c,
            "BR-DE-15",
            "Leitweg-ID bzw. Käuferreferenz (BT-10) fehlt",
            "Buyer reference / Leitweg-ID (BT-10) is missing",
        );
    }
    if let Some(code) = view.type_code.as_deref() {
        if !listed(XRECHNUNG_TYPE_CODES, code) {
            f.add_text(
                "BR-DE-17",
                c.pick(
                    format!("Rechnungstyp „{code}“ ist in der XRechnung nicht zulässig (326, 380, 381, 384, 389, 875, 876, 877)"),
                    format!("Invoice type \"{code}\" is not allowed in XRechnung (326, 380, 381, 384, 389, 875, 876, 877)"),
                ),
            );
        }
    }
    if view.type_code.as_deref() == Some("384") && view.preceding_invoices.is_empty() {
        f.add(
            c,
            "BR-DE-26",
            "Eine Korrekturrechnung (384) braucht die Nummer der korrigierten Rechnung (BG-3)",
            "A corrective invoice (384) needs the number of the corrected invoice (BG-3)",
        );
    }
    if used_categories(view)
        .iter()
        .any(|category| listed(SELLER_TAX_ID, category))
        && s.vat_id.is_none()
        && s.tax_number.is_none()
    {
        f.add(
            c,
            "BR-DE-16",
            "USt-IdNr. oder Steuernummer des Verkäufers fehlt",
            "Seller VAT ID or tax number is missing",
        );
    }
    for x in &view.taxes {
        if x.rate.is_none() {
            let category = x.category.as_deref().unwrap_or("?");
            f.add_text(
                "BR-DE-14",
                c.pick(
                    format!("{category}: Steuersatz (BT-119) fehlt"),
                    format!("{category}: VAT rate (BT-119) is missing"),
                ),
            );
        }
    }
    for p in &view.payments {
        if let (Some("58"), Some(iban)) = (p.code.as_deref(), p.iban.as_deref()) {
            if !iban_ok(iban) {
                f.add_text(
                    "BR-DE-19",
                    c.pick(
                        format!("IBAN {iban} hat eine falsche Prüfsumme"),
                        format!("IBAN {iban} has a wrong checksum"),
                    ),
                );
            }
        }
    }

    Some(result(
        "xrechnung-rules",
        c.tr(
            "Regeln der XRechnung (Auswahl: BR-DE-1 bis -9, -14 bis -17, -19, -26 bis -28)",
            "XRechnung rules (selection: BR-DE-1 to -9, -14 to -17, -19, -26 to -28)",
        ),
        f,
    ))
}

pub(super) fn code_list_checks(c: &Ctx, view: &InvoiceView) -> CheckResult {
    let mut f = Findings::default();
    if let Some(cur) = view.currency.as_deref() {
        if cur.len() == 3 && cur.bytes().all(|b| b.is_ascii_uppercase()) && !listed(CURRENCIES, cur)
        {
            f.add_text(
                "BR-CL-03",
                c.pick(
                    format!("Währung „{cur}“ steht nicht in ISO 4217"),
                    format!("Currency \"{cur}\" is not in ISO 4217"),
                ),
            );
        }
    }
    if let Some(code) = view.type_code.as_deref() {
        if !listed(TYPE_CODES, code) {
            f.add_text(
                "BR-CL-01",
                c.pick(
                    format!("Rechnungstyp „{code}“ steht nicht in der Codeliste UNTDID 1001"),
                    format!("Invoice type \"{code}\" is not in the UNTDID 1001 code list"),
                ),
            );
        }
    }
    let parties = [
        ("Verkäufer", "seller", view.seller.country.as_deref()),
        ("Käufer", "buyer", view.buyer.country.as_deref()),
        (
            "Zahlungsempfänger",
            "payee",
            view.payee.as_ref().and_then(|p| p.country.as_deref()),
        ),
    ];
    for (de, en, country) in parties {
        if let Some(country) = country {
            if !listed(COUNTRIES, country) {
                f.add_text(
                    "BR-CL-14",
                    c.pick(
                        format!("Land des {de}s „{country}“ steht nicht in ISO 3166-1"),
                        format!("Country of the {en} \"{country}\" is not in ISO 3166-1"),
                    ),
                );
            }
        }
    }
    for category in used_categories(view) {
        if !listed(TAX_CATEGORIES, &category) {
            f.add_text(
                "BR-CL-18",
                c.pick(
                    format!("Steuerkategorie „{category}“ steht nicht in UNCL 5305"),
                    format!("Tax category \"{category}\" is not in UNCL 5305"),
                ),
            );
        }
    }
    for x in &view.taxes {
        if let Some(category) = x.category.as_deref() {
            if !listed(TAX_CATEGORIES, category) {
                f.add_text(
                    "BR-CL-17",
                    c.pick(
                        format!("Steuerkategorie „{category}“ steht nicht in UNCL 5305"),
                        format!("Tax category \"{category}\" is not in UNCL 5305"),
                    ),
                );
            }
        }
    }
    for p in &view.payments {
        if let Some(code) = p.code.as_deref() {
            if !payment_means_known(code) {
                f.add_text(
                    "BR-CL-16",
                    c.pick(
                        format!("Zahlungsart „{code}“ steht nicht in UNTDID 4461"),
                        format!("Payment means \"{code}\" is not in UNTDID 4461"),
                    ),
                );
            }
        }
    }
    for (i, line) in view.items.iter().enumerate() {
        if let Some(unit) = line.unit.as_deref() {
            let shape = (2..=3).contains(&unit.len())
                && unit
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
            if !shape {
                let label = c.line_label(line, i);
                f.add_text(
                    "BR-CL-23",
                    c.pick(
                        format!("{label}: Einheit „{unit}“ ist kein Code nach UN/ECE Rec. 20/21"),
                        format!("{label}: unit \"{unit}\" is not a UN/ECE Rec. 20/21 code"),
                    ),
                );
            }
        }
    }
    result(
        "code-lists",
        c.tr(
            "Codelisten: Währung, Länder, Rechnungstyp, Steuerkategorie, Zahlungsart, Format der Einheit",
            "Code lists: currency, countries, invoice type, tax category, payment means, unit format",
        ),
        f,
    )
}

pub(super) fn rule_checks(c: &Ctx, view: &InvoiceView) -> Vec<CheckResult> {
    let mut out = vec![en16931_rules(c, view)];
    out.extend(xrechnung_rules(c, view));
    out.push(code_list_checks(c, view));
    out
}
