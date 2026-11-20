//! The normalized view of a received e-invoice and the readers that fill it. A port of
//! `frontend/src/lib/einvoice/{types,parse,parseUtil,parseCii,parseUbl}.ts`; both sides must give the same result
//! for the same file (see the shared golden files in `frontend/src/lib/einvoice/testdata/expected/`).

use super::xml::{find, find_all, kids, parse_xml, text, XmlNode};
use serde::Serialize;
use utoipa::ToSchema;

/// Why a file could not be turned into a view.
#[derive(Debug, PartialEq, Eq)]
pub enum ParseError {
    InvalidXml(String),
    UnsupportedRoot(String),
    Zugferd1,
}

/// One syntax-independent view of a received e-invoice (CII: ZUGFeRD/Factur-X/XRechnung CII, UBL: XRechnung UBL/Peppol).
/// Missing optional parts are left out of the JSON.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceView {
    /// Syntax of the XML: `cii` or `ubl`.
    pub syntax: Syntax,
    /// UNTDID 1001 code from BT-3 (`380` invoice, `381` credit note, ...).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_code: Option<String>,
    /// Specification identifier (BT-24), e.g. `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    /// ISO date (`YYYY-MM-DD`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_date: Option<String>,
    /// ISO date (`YYYY-MM-DD`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    /// ISO date (`YYYY-MM-DD`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buyer_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_reference: Option<String>,
    pub preceding_invoices: Vec<PrecedingInvoice>,
    pub seller: Party,
    pub buyer: Party,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payee: Option<Party>,
    pub notes: Vec<String>,
    pub items: Vec<LineView>,
    /// Document level allowances and charges.
    pub adjustments: Vec<Adjustment>,
    pub taxes: Vec<TaxView>,
    pub totals: Totals,
    pub payments: Vec<PaymentMeans>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_terms: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Syntax {
    Cii,
    Ubl,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrecedingInvoice {
    pub number: String,
    /// ISO date
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

#[derive(Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Party {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trade_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub street: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub street2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub postcode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vat_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tax_number: Option<String>,
    /// Legal registration (e.g. commercial register number).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LineView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seller_item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buyer_item_id: Option<String>,
    #[schema(required = true)]
    pub quantity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    /// Net unit price (BT-146).
    #[schema(required = true)]
    pub price: Option<f64>,
    /// Quantity the price refers to (BT-149), 1 when not given.
    pub price_basis: f64,
    /// Net line amount (BT-131).
    #[schema(required = true)]
    pub net: Option<f64>,
    /// The line has its own allowances or charges, so quantity × price does not have to equal the net amount.
    pub has_adjustments: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tax_category: Option<String>,
    #[schema(required = true)]
    pub tax_rate: Option<f64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Adjustment {
    /// `true` for a charge, `false` for an allowance.
    pub charge: bool,
    #[schema(required = true)]
    pub amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tax_category: Option<String>,
    #[schema(required = true)]
    pub tax_rate: Option<f64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaxView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[schema(required = true)]
    pub rate: Option<f64>,
    #[schema(required = true)]
    pub basis: Option<f64>,
    #[schema(required = true)]
    pub amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exemption_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exemption_code: Option<String>,
}

/// Amounts of the document; `null` when the file does not state them.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    #[schema(required = true)]
    pub line_total: Option<f64>,
    #[schema(required = true)]
    pub allowance_total: Option<f64>,
    #[schema(required = true)]
    pub charge_total: Option<f64>,
    /// Total without VAT (BT-109).
    #[schema(required = true)]
    pub tax_basis: Option<f64>,
    #[schema(required = true)]
    pub tax_total: Option<f64>,
    /// Total with VAT (BT-112).
    #[schema(required = true)]
    pub grand_total: Option<f64>,
    #[schema(required = true)]
    pub prepaid: Option<f64>,
    #[schema(required = true)]
    pub rounding: Option<f64>,
    /// Amount due for payment (BT-115).
    #[schema(required = true)]
    pub due: Option<f64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMeans {
    /// UNTDID 4461 code (`58` SEPA credit transfer, `59` SEPA direct debit, `30` credit transfer, ...).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iban: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bank_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

/// A trimmed number, `None` when missing, empty or not finite.
fn num(value: Option<&str>) -> Option<f64> {
    let trimmed = value?.trim();
    trimmed.parse::<f64>().ok().filter(|n| n.is_finite())
}

/// `num(...) || 1` in the TypeScript reader: missing, unparsable and zero all fall back to 1.
fn basis_of(value: Option<&str>) -> f64 {
    num(value).filter(|n| *n != 0.0).unwrap_or(1.0)
}

/// CII dates use UN/EDIFACT formats (102 = `YYYYMMDD`); UBL uses ISO dates. Returns an ISO date.
fn iso_date(value: Option<&str>, format: Option<&str>) -> Option<String> {
    let v = value?.trim();
    if v.is_empty() {
        return None;
    }
    if v.len() == 8
        && v.bytes().all(|b| b.is_ascii_digit())
        && matches!(format, None | Some("") | Some("102"))
    {
        return Some(format!("{}-{}-{}", &v[..4], &v[4..6], &v[6..8]));
    }
    let b = v.as_bytes();
    let iso = b.len() >= 10
        && b[..10].iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        });
    Some(if iso {
        v[..10].to_string()
    } else {
        v.to_string()
    })
}

fn opt_text(node: Option<&XmlNode>, path: &str) -> Option<String> {
    text(node, path)
}

fn defined_list(list: impl IntoIterator<Item = Option<String>>) -> Vec<String> {
    list.into_iter().flatten().collect()
}

fn joined(list: Vec<String>) -> Option<String> {
    let joined = list.join("\n");
    (!joined.is_empty()).then_some(joined)
}

/// Reads a CII or UBL e-invoice. Missing optional parts stay `None`; only an unreadable file or an unsupported
/// syntax is an error.
pub fn parse_einvoice(xml: &str) -> Result<InvoiceView, ParseError> {
    let root = parse_xml(xml).map_err(ParseError::InvalidXml)?;
    match root.name.as_str() {
        "CrossIndustryInvoice" => Ok(parse_cii(&root)),
        "Invoice" | "CreditNote" => Ok(parse_ubl(&root)),
        "CrossIndustryDocument" => Err(ParseError::Zugferd1),
        other => Err(ParseError::UnsupportedRoot(other.to_string())),
    }
}

fn cii_party(party: Option<&XmlNode>) -> Party {
    let address = find(party, "PostalTradeAddress");
    let registrations = find_all(party, "SpecifiedTaxRegistration/ID");
    let contact = find(party, "DefinedTradeContact");
    let registration = |scheme: &str| {
        registrations
            .iter()
            .find(|r| r.attr("schemeID") == Some(scheme))
            .map(|r| r.text.clone())
            .filter(|t| !t.is_empty())
    };
    Party {
        name: opt_text(party, "Name"),
        street: opt_text(address, "LineOne"),
        street2: opt_text(address, "LineTwo").or_else(|| opt_text(address, "LineThree")),
        postcode: opt_text(address, "PostcodeCode"),
        city: opt_text(address, "CityName"),
        country: opt_text(address, "CountryID"),
        vat_id: registration("VA"),
        tax_number: registration("FC"),
        registration: opt_text(party, "SpecifiedLegalOrganization/ID"),
        contact_name: opt_text(contact, "PersonName")
            .or_else(|| opt_text(contact, "DepartmentName")),
        phone: opt_text(contact, "TelephoneUniversalCommunication/CompleteNumber"),
        email: opt_text(contact, "EmailURIUniversalCommunication/URIID"),
        ..Party::default()
    }
}

fn cii_date(node: Option<&XmlNode>) -> Option<String> {
    let date = find(node, "DateTimeString");
    iso_date(
        date.map(|d| d.text.as_str()),
        date.and_then(|d| d.attr("format")),
    )
}

fn parse_cii(root: &XmlNode) -> InvoiceView {
    let root = Some(root);
    let doc = find(root, "ExchangedDocument");
    let trade = find(root, "SupplyChainTradeTransaction");
    let agreement = find(trade, "ApplicableHeaderTradeAgreement");
    let delivery = find(trade, "ApplicableHeaderTradeDelivery");
    let settlement = find(trade, "ApplicableHeaderTradeSettlement");
    let sum = find(
        settlement,
        "SpecifiedTradeSettlementHeaderMonetarySummation",
    );
    let tax_currency = opt_text(settlement, "TaxCurrencyCode");
    let currency = opt_text(settlement, "InvoiceCurrencyCode");

    let items = kids(trade, "IncludedSupplyChainTradeLineItem")
        .into_iter()
        .map(|line| {
            let line = Some(line);
            let line_tax = find(line, "SpecifiedLineTradeSettlement/ApplicableTradeTax");
            let quantity = find(line, "SpecifiedLineTradeDelivery/BilledQuantity");
            let basis = find(
                line,
                "SpecifiedLineTradeAgreement/NetPriceProductTradePrice/BasisQuantity",
            );
            LineView {
                id: opt_text(line, "AssociatedDocumentLineDocument/LineID"),
                name: opt_text(line, "SpecifiedTradeProduct/Name"),
                description: opt_text(line, "SpecifiedTradeProduct/Description"),
                note: opt_text(line, "AssociatedDocumentLineDocument/IncludedNote/Content"),
                seller_item_id: opt_text(line, "SpecifiedTradeProduct/SellerAssignedID"),
                buyer_item_id: opt_text(line, "SpecifiedTradeProduct/BuyerAssignedID"),
                quantity: num(quantity.map(|q| q.text.as_str())),
                unit: quantity.and_then(|q| q.attr("unitCode")).map(str::to_string),
                price: num(
                    opt_text(
                        line,
                        "SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount",
                    )
                    .as_deref(),
                ),
                price_basis: basis_of(basis.map(|b| b.text.as_str())),
                net: num(
                    opt_text(
                        line,
                        "SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount",
                    )
                    .as_deref(),
                ),
                has_adjustments: !kids(
                    find(line, "SpecifiedLineTradeSettlement"),
                    "SpecifiedTradeAllowanceCharge",
                )
                .is_empty(),
                tax_category: opt_text(line_tax, "CategoryCode"),
                tax_rate: num(opt_text(line_tax, "RateApplicablePercent").as_deref()),
            }
        })
        .collect();

    let adjustments = kids(settlement, "SpecifiedTradeAllowanceCharge")
        .into_iter()
        .map(|a| {
            let a = Some(a);
            Adjustment {
                charge: opt_text(a, "ChargeIndicator/Indicator").as_deref() == Some("true"),
                amount: num(opt_text(a, "ActualAmount").as_deref()),
                reason: opt_text(a, "Reason"),
                tax_category: opt_text(a, "CategoryTradeTax/CategoryCode"),
                tax_rate: num(opt_text(a, "CategoryTradeTax/RateApplicablePercent").as_deref()),
            }
        })
        .collect();

    let taxes = kids(settlement, "ApplicableTradeTax")
        .into_iter()
        .map(|t| {
            let t = Some(t);
            TaxView {
                category: opt_text(t, "CategoryCode"),
                rate: num(opt_text(t, "RateApplicablePercent").as_deref()),
                basis: num(opt_text(t, "BasisAmount").as_deref()),
                amount: num(opt_text(t, "CalculatedAmount").as_deref()),
                exemption_reason: opt_text(t, "ExemptionReason"),
                exemption_code: opt_text(t, "ExemptionReasonCode"),
            }
        })
        .collect();

    // The tax total in the invoice currency (the other one is in the VAT accounting currency BT-6)
    let tax_totals = kids(sum, "TaxTotalAmount");
    let tax_total = tax_totals
        .iter()
        .find(|t| {
            tax_currency.is_none()
                || t.attr("currencyID").is_none_or(|c| c.is_empty())
                || t.attr("currencyID") == currency.as_deref()
        })
        .or(tax_totals.first());

    let payments = kids(settlement, "SpecifiedTradeSettlementPaymentMeans")
        .into_iter()
        .map(|p| {
            let p = Some(p);
            PaymentMeans {
                code: opt_text(p, "TypeCode"),
                iban: opt_text(p, "PayeePartyCreditorFinancialAccount/IBANID"),
                bic: opt_text(p, "PayeeSpecifiedCreditorFinancialInstitution/BICID"),
                bank_name: opt_text(p, "PayeeSpecifiedCreditorFinancialInstitution/Name"),
                account_name: opt_text(p, "PayeePartyCreditorFinancialAccount/AccountName"),
                reference: None,
            }
        })
        .collect();

    let terms = kids(settlement, "SpecifiedTradePaymentTerms");
    let payee = find(settlement, "PayeeTradeParty");

    InvoiceView {
        syntax: Syntax::Cii,
        type_code: opt_text(doc, "TypeCode"),
        profile: opt_text(
            root,
            "ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID",
        ),
        number: opt_text(doc, "ID"),
        issue_date: cii_date(find(doc, "IssueDateTime")),
        due_date: cii_date(find(terms.first().copied(), "DueDateDateTime")),
        delivery_date: cii_date(find(
            delivery,
            "ActualDeliverySupplyChainEvent/OccurrenceDateTime",
        )),
        currency,
        buyer_reference: opt_text(agreement, "BuyerReference"),
        order_reference: opt_text(agreement, "BuyerOrderReferencedDocument/IssuerAssignedID"),
        contract_reference: opt_text(agreement, "ContractReferencedDocument/IssuerAssignedID"),
        payment_reference: opt_text(settlement, "PaymentReference"),
        preceding_invoices: kids(settlement, "InvoiceReferencedDocument")
            .into_iter()
            .map(|d| PrecedingInvoice {
                number: opt_text(Some(d), "IssuerAssignedID").unwrap_or_default(),
                date: cii_date(find(Some(d), "FormattedIssueDateTime")),
            })
            .collect(),
        seller: cii_party(find(agreement, "SellerTradeParty")),
        buyer: cii_party(find(agreement, "BuyerTradeParty")),
        payee: payee.map(|p| cii_party(Some(p))),
        notes: defined_list(
            kids(doc, "IncludedNote")
                .into_iter()
                .map(|n| opt_text(Some(n), "Content")),
        ),
        items,
        adjustments,
        taxes,
        totals: Totals {
            line_total: num(opt_text(sum, "LineTotalAmount").as_deref()),
            allowance_total: num(opt_text(sum, "AllowanceTotalAmount").as_deref()),
            charge_total: num(opt_text(sum, "ChargeTotalAmount").as_deref()),
            tax_basis: num(opt_text(sum, "TaxBasisTotalAmount").as_deref()),
            tax_total: num(tax_total.map(|t| t.text.as_str())),
            grand_total: num(opt_text(sum, "GrandTotalAmount").as_deref()),
            prepaid: num(opt_text(sum, "TotalPrepaidAmount").as_deref()),
            rounding: num(opt_text(sum, "RoundingAmount").as_deref()),
            due: num(opt_text(sum, "DuePayableAmount").as_deref()),
        },
        payments,
        payment_terms: joined(defined_list(
            terms.iter().map(|t| opt_text(Some(t), "Description")),
        )),
    }
}

fn ubl_party(wrapper: Option<&XmlNode>) -> Party {
    let party = find(wrapper, "Party").or(wrapper);
    let schemes = find_all(party, "PartyTaxScheme");
    let legal = find(party, "PartyLegalEntity");
    let scheme_is_vat = |s: &XmlNode| {
        opt_text(Some(s), "TaxScheme/ID")
            .map(|id| id.to_uppercase())
            .as_deref()
            == Some("VAT")
    };
    let vat = schemes.iter().find(|s| scheme_is_vat(s));
    let other = schemes.iter().find(|s| !scheme_is_vat(s));
    let trading = opt_text(party, "PartyName/Name");
    let registered = opt_text(legal, "RegistrationName");
    let address = find(party, "PostalAddress");
    let trade_name = match (&registered, &trading) {
        (Some(r), Some(t)) if r != t => Some(t.clone()),
        _ => None,
    };
    Party {
        name: registered.or(trading),
        trade_name,
        street: opt_text(address, "StreetName"),
        street2: opt_text(address, "AdditionalStreetName"),
        postcode: opt_text(address, "PostalZone"),
        city: opt_text(address, "CityName"),
        country: opt_text(address, "Country/IdentificationCode"),
        vat_id: opt_text(vat.copied(), "CompanyID"),
        tax_number: opt_text(other.copied(), "CompanyID"),
        registration: opt_text(legal, "CompanyID"),
        contact_name: opt_text(party, "Contact/Name"),
        phone: opt_text(party, "Contact/Telephone"),
        email: opt_text(party, "Contact/ElectronicMail"),
    }
}

fn parse_ubl(root: &XmlNode) -> InvoiceView {
    let credit = root.name == "CreditNote";
    let line_name = if credit {
        "CreditNoteLine"
    } else {
        "InvoiceLine"
    };
    let qty_name = if credit {
        "CreditedQuantity"
    } else {
        "InvoicedQuantity"
    };
    let root = Some(root);
    let terms = kids(root, "PaymentTerms");

    let items = kids(root, line_name)
        .into_iter()
        .map(|line| {
            let line = Some(line);
            let quantity = find(line, qty_name);
            let base = find(line, "Price/BaseQuantity");
            LineView {
                id: opt_text(line, "ID"),
                name: opt_text(line, "Item/Name"),
                description: opt_text(line, "Item/Description"),
                note: opt_text(line, "Note"),
                seller_item_id: opt_text(line, "Item/SellersItemIdentification/ID"),
                buyer_item_id: opt_text(line, "Item/BuyersItemIdentification/ID"),
                quantity: num(quantity.map(|q| q.text.as_str())),
                unit: quantity
                    .and_then(|q| q.attr("unitCode"))
                    .map(str::to_string),
                price: num(opt_text(line, "Price/PriceAmount").as_deref()),
                price_basis: basis_of(base.map(|b| b.text.as_str())),
                net: num(opt_text(line, "LineExtensionAmount").as_deref()),
                has_adjustments: !kids(line, "AllowanceCharge").is_empty(),
                tax_category: opt_text(line, "Item/ClassifiedTaxCategory/ID"),
                tax_rate: num(opt_text(line, "Item/ClassifiedTaxCategory/Percent").as_deref()),
            }
        })
        .collect();

    let adjustments = kids(root, "AllowanceCharge")
        .into_iter()
        .map(|a| {
            let a = Some(a);
            Adjustment {
                charge: opt_text(a, "ChargeIndicator").as_deref() == Some("true"),
                amount: num(opt_text(a, "Amount").as_deref()),
                reason: opt_text(a, "AllowanceChargeReason"),
                tax_category: opt_text(a, "TaxCategory/ID"),
                tax_rate: num(opt_text(a, "TaxCategory/Percent").as_deref()),
            }
        })
        .collect();

    let tax_currency = opt_text(root, "TaxCurrencyCode");
    let currency = opt_text(root, "DocumentCurrencyCode");
    let tax_totals = kids(root, "TaxTotal");
    let main_tax_total = tax_totals
        .iter()
        .find(|t| {
            tax_currency.is_none()
                || tax_currency == currency
                || find(Some(*t), "TaxAmount").and_then(|a| a.attr("currencyID"))
                    != tax_currency.as_deref()
        })
        .or(tax_totals.first())
        .copied();
    let taxes = find_all(main_tax_total, "TaxSubtotal")
        .into_iter()
        .map(|t| {
            let t = Some(t);
            TaxView {
                category: opt_text(t, "TaxCategory/ID"),
                rate: num(opt_text(t, "TaxCategory/Percent").as_deref()),
                basis: num(opt_text(t, "TaxableAmount").as_deref()),
                amount: num(opt_text(t, "TaxAmount").as_deref()),
                exemption_reason: opt_text(t, "TaxCategory/TaxExemptionReason"),
                exemption_code: opt_text(t, "TaxCategory/TaxExemptionReasonCode"),
            }
        })
        .collect();

    let monetary = find(root, "LegalMonetaryTotal");
    let payments: Vec<PaymentMeans> = kids(root, "PaymentMeans")
        .into_iter()
        .map(|p| {
            let p = Some(p);
            PaymentMeans {
                code: opt_text(p, "PaymentMeansCode"),
                iban: opt_text(p, "PayeeFinancialAccount/ID"),
                bic: opt_text(p, "PayeeFinancialAccount/FinancialInstitutionBranch/ID"),
                bank_name: opt_text(p, "PayeeFinancialAccount/FinancialInstitutionBranch/Name"),
                account_name: opt_text(p, "PayeeFinancialAccount/Name"),
                reference: opt_text(p, "PaymentID"),
            }
        })
        .collect();

    let payee = find(root, "PayeeParty");
    InvoiceView {
        syntax: Syntax::Ubl,
        type_code: opt_text(
            root,
            if credit {
                "CreditNoteTypeCode"
            } else {
                "InvoiceTypeCode"
            },
        ),
        profile: opt_text(root, "CustomizationID"),
        number: opt_text(root, "ID"),
        issue_date: iso_date(opt_text(root, "IssueDate").as_deref(), None),
        due_date: iso_date(
            opt_text(
                root,
                if credit {
                    "PaymentMeans/PaymentDueDate"
                } else {
                    "DueDate"
                },
            )
            .as_deref(),
            None,
        ),
        delivery_date: iso_date(
            opt_text(root, "Delivery/ActualDeliveryDate").as_deref(),
            None,
        ),
        currency,
        buyer_reference: opt_text(root, "BuyerReference"),
        order_reference: opt_text(root, "OrderReference/ID"),
        contract_reference: opt_text(root, "ContractDocumentReference/ID"),
        payment_reference: payments.iter().find_map(|p| p.reference.clone()),
        preceding_invoices: find_all(root, "BillingReference/InvoiceDocumentReference")
            .into_iter()
            .map(|d| PrecedingInvoice {
                number: opt_text(Some(d), "ID").unwrap_or_default(),
                date: iso_date(opt_text(Some(d), "IssueDate").as_deref(), None),
            })
            .collect(),
        seller: ubl_party(find(root, "AccountingSupplierParty")),
        buyer: ubl_party(find(root, "AccountingCustomerParty")),
        payee: payee.map(|p| ubl_party(Some(p))),
        notes: kids(root, "Note")
            .into_iter()
            .map(|n| n.text.clone())
            .filter(|t| !t.is_empty())
            .collect(),
        items,
        adjustments,
        taxes,
        totals: Totals {
            line_total: num(opt_text(monetary, "LineExtensionAmount").as_deref()),
            allowance_total: num(opt_text(monetary, "AllowanceTotalAmount").as_deref()),
            charge_total: num(opt_text(monetary, "ChargeTotalAmount").as_deref()),
            tax_basis: num(opt_text(monetary, "TaxExclusiveAmount").as_deref()),
            tax_total: num(find(main_tax_total, "TaxAmount").map(|t| t.text.as_str())),
            grand_total: num(opt_text(monetary, "TaxInclusiveAmount").as_deref()),
            prepaid: num(opt_text(monetary, "PrepaidAmount").as_deref()),
            rounding: num(opt_text(monetary, "PayableRoundingAmount").as_deref()),
            due: num(opt_text(monetary, "PayableAmount").as_deref()),
        },
        payments,
        payment_terms: joined(defined_list(
            terms.iter().map(|t| opt_text(Some(t), "Note")),
        )),
    }
}
