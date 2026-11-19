use super::*;

#[test]
fn preview_zone_header_is_opt_in() {
    assert!(!PreviewQuery { zones: None }.includes_zones());
    assert!(!PreviewQuery {
        zones: Some("true".into()),
    }
    .includes_zones());
    assert!(PreviewQuery {
        zones: Some("1".into()),
    }
    .includes_zones());

    let zones = [ZoneRect {
        zone: 3,
        page: 1,
        x: 25.0,
        y: 40.0,
        w: 165.0,
        h: 30.0,
    }];
    let response = pdf_response(Vec::new(), "invoice.pdf", Some(&zones));
    let encoded = response.headers()["x-pdfcraft-zones"].to_str().unwrap();
    let parsed: serde_json::Value = serde_json::from_str(encoded).unwrap();
    assert_eq!(parsed[0]["zone"], 3);
    assert_eq!(parsed[0]["page"], 1);
    assert_eq!(parsed[0]["w"], 165.0);
    assert!(!pdf_response(Vec::new(), "invoice.pdf", None)
        .headers()
        .contains_key("x-pdfcraft-zones"));
}

#[test]
fn invoice_service_dates_are_optional_and_validate_as_a_period() {
    let base = json!({
        "number": "2026-001",
        "date": "2026-01-31",
        "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
        "items": [{"description": "Beratung", "quantity": 1, "unit": "h", "price": 95, "taxRate": 19}],
    });
    let check = |value: serde_json::Value| {
        let invoice: Invoice = serde_json::from_value(value).unwrap();
        let mut errors = Errors::default();
        check_invoice(&invoice, "invoice", &mut errors);
        errors.0
    };
    assert!(check(base.clone()).is_empty());

    let mut period = base.clone();
    period["serviceDateFrom"] = json!("2026-01-01");
    period["serviceDateTo"] = json!("2026-01-31");
    period["dueDate"] = json!("2026-03-02");
    assert!(check(period.clone()).is_empty());

    let mut incomplete = period.clone();
    incomplete.as_object_mut().unwrap().remove("serviceDateTo");
    assert!(check(incomplete)
        .iter()
        .any(|issue| issue.contains("serviceDateFrom and serviceDateTo")));

    let mut reversed = period.clone();
    reversed["serviceDateFrom"] = json!("2026-02-01");
    assert!(check(reversed)
        .iter()
        .any(|issue| issue.contains("must not be after")));

    let mut mixed = period.clone();
    mixed["serviceDate"] = json!("2026-01-15");
    assert!(check(mixed)
        .iter()
        .any(|issue| issue.contains("cannot be combined")));

    let mut early_due = base;
    early_due["dueDate"] = json!("2026-01-30");
    assert!(check(early_due)
        .iter()
        .any(|issue| issue.contains("dueDate must not be before")));
}

#[tokio::test]
async fn invoice_service_period_and_due_date_reach_the_pdf_and_xml() {
    let settings: Settings = serde_json::from_value(json!({
        "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
        "zugferd": true,
    }))
    .unwrap();
    let invoice: Invoice = serde_json::from_value(json!({
            "number": "2026-001",
            "date": "2026-01-31",
            "serviceDateFrom": "2026-01-01",
            "serviceDateTo": "2026-01-31",
            "dueDate": "2026-03-02",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 1, "unit": "h", "price": 95, "taxRate": 19}],
        }))
        .unwrap();
    let mut errors = Errors::default();
    let checked_settings = check_settings(&settings, &mut errors);
    let checked_invoice = check_invoice(&invoice, "invoice", &mut errors);
    assert!(errors.0.is_empty(), "{:?}", errors.0);
    let (data, assets) = invoice_data(
        &settings,
        checked_settings.data,
        &invoice,
        checked_invoice,
        Vec::new(),
    );
    assert_eq!(
        data["invoice"]["serviceDateText"],
        "01.01.2026 – 31.01.2026"
    );
    assert_eq!(data["invoice"]["dueDateText"], "02.03.2026");
    let xml = assets
        .iter()
        .find(|(name, _)| name == "xml")
        .map(|(_, bytes)| std::str::from_utf8(bytes).unwrap())
        .unwrap();
    assert!(xml.contains("<ram:StartDateTime>"));
    assert!(xml.contains("<ram:EndDateTime>"));
    assert!(xml.contains("20260101"));
    assert!(xml.contains("20260131"));
    assert!(xml.contains("20260302"));
    let pdf = render_pdf(INVOICE_TEMPLATE, data, assets)
        .await
        .unwrap_or_else(|e| panic!("{}", e.details));
    assert!(pdf.starts_with(b"%PDF"));
}

#[tokio::test]
async fn preview_zone_geometry_renders_all_document_types() {
    let settings: Settings = serde_json::from_value(json!({
        "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
        "zugferd": false,
    }))
    .unwrap();
    let checked_settings = {
        let mut errors = Errors::default();
        let checked = check_settings(&settings, &mut errors);
        assert!(errors.0.is_empty(), "{:?}", errors.0);
        checked
    };
    let raw: Document = serde_json::from_value(json!({
            "number": "2026-001",
            "date": "2026-01-31",
            "reference": "R-2026-007",
            "referenceDate": "2026-01-02",
            "validUntil": "2026-02-28",
            "deliveryDate": "2026-02-03",
            "subject": "Betreff",
            "body": "Brieftext",
            "dunningLevel": 2, "paymentDeadline": "2026-02-14", "invoices": [{"number": "R-2026-007", "date": "2026-01-02", "dueDate": "2026-01-16", "openAmount": 1000.5}], "fees": [{"description": "Mahngebühr", "amount": 5}], "interest": {"rate": 12.27, "from": "2026-01-17", "to": "2026-01-31", "amount": 4.71},
            "reason": "Falsche Menge",
            "intro": "Einleitung",
            "closing": "Gruß",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 2, "unit": "h", "price": 95, "taxRate": 19}],
        }))
        .unwrap();
    for kind in Kind::ALL {
        let mut errors = Errors::default();
        let checked = documents::check_document(kind, &raw, false, &mut errors);
        assert!(errors.0.is_empty(), "{}: {:?}", kind.slug(), errors.0);
        let (data, assets) = documents::build(
            kind,
            &settings,
            checked_settings.data.clone(),
            &raw,
            checked,
            Vec::new(),
        );
        let (pdf, zones) = render_pdf_with_zones(kind.template(), data, assets)
            .await
            .unwrap_or_else(|e| panic!("{}: {}", kind.slug(), e.details));
        assert!(pdf.starts_with(b"%PDF"), "{}", kind.slug());
        assert!(zones.iter().any(|zone| zone.zone == 3), "{}", kind.slug());
        assert!(zones.iter().any(|zone| zone.zone == 4), "{}", kind.slug());
        assert!(zones.iter().all(|zone| {
            zone.page >= 1
                && zone.x.is_finite()
                && zone.y.is_finite()
                && zone.w > 0.0
                && zone.h > 0.0
        }));
    }

    let items: Vec<_> = (0..100)
        .map(|index| {
            json!({
                "description": format!("Position {index}: detailed service description"),
                "quantity": 1,
                "unit": "pcs",
                "price": 10,
                "taxRate": 19,
            })
        })
        .collect();
    let invoice: Invoice = serde_json::from_value(json!({
        "number": "2026-MULTI",
        "date": "2026-01-31",
        "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
        "items": items,
    }))
    .unwrap();
    let mut errors = Errors::default();
    let checked = check_invoice(&invoice, "invoice", &mut errors);
    assert!(errors.0.is_empty(), "{:?}", errors.0);
    let (data, assets) = invoice_data(
        &settings,
        checked_settings.data,
        &invoice,
        checked,
        Vec::new(),
    );
    let (pdf, zones) = render_pdf_with_zones(INVOICE_TEMPLATE, data, assets)
        .await
        .unwrap_or_else(|e| panic!("multi-page invoice: {}", e.details));
    let item_zones: Vec<_> = zones.iter().filter(|zone| zone.zone == 4).collect();
    assert!(pdf.starts_with(b"%PDF"));
    assert!(item_zones.iter().any(|zone| zone.page == 1));
    assert!(item_zones.iter().any(|zone| zone.page > 1));
    if let Ok(dir) = std::env::var("PDF_OUT") {
        std::fs::write(format!("{dir}/invoice-zone-multipage.pdf"), pdf).unwrap();
    }
}

#[test]
fn draft_option_adds_the_watermark_for_any_token() {
    let client = |kind| Client {
        id: "t".into(),
        kind,
        plan: "p".into(),
        limit: 10,
        created: None,
    };
    let draft: Options = serde_json::from_value(json!({"watermark": "draft"})).unwrap();
    let none = Options::default();
    let watermark = |kind, options: &Options, locale: &str| {
        with_watermark(&client(kind), options, json!({"locale": locale}))
            .get("watermark")
            .and_then(|v| v.as_str().map(str::to_string))
    };

    assert_eq!(watermark(store::Kind::Paid, &none, "de"), None);
    assert_eq!(watermark(store::Kind::Service, &none, "de"), None);
    assert_eq!(
        watermark(store::Kind::Paid, &draft, "de").as_deref(),
        Some("Entwurf")
    );
    assert_eq!(
        watermark(store::Kind::Service, &draft, "en-de").as_deref(),
        Some("Draft")
    );
    // free tokens keep the watermark with and without the option
    assert_eq!(
        watermark(store::Kind::Free, &none, "en-de").as_deref(),
        Some("Draft")
    );
    assert_eq!(
        watermark(store::Kind::Free, &draft, "de").as_deref(),
        Some("Entwurf")
    );

    assert!(serde_json::from_value::<Options>(json!({"watermark": "final"})).is_err());
    let request: InvoiceRequest = serde_json::from_value(json!({
        "settings": {}, "invoice": {}, "options": {"watermark": "draft"}
    }))
    .unwrap();
    assert!(request.options.watermark == Some(WatermarkOption::Draft));
}

#[tokio::test]
async fn render_all_keeps_order_and_names_the_failing_entry() {
    let client = Client {
        id: "t".into(),
        kind: store::Kind::Free,
        plan: "free".into(),
        limit: 10,
        created: None,
    };
    const PAGE: &str = "#set document(date: datetime(year: 2026, month: 1, day: 1))\n#set page(width: 40mm, height: 20mm)\n{% if n == 1 %}#panic(\"boom\")\n{% endif %}Nr {{ n }}";
    let jobs = |ns: &[u32]| {
        ns.iter()
            .map(|n| (json!({ "n": n }), Vec::new()))
            .collect::<Vec<_>>()
    };

    let pdfs = render_all(&client, PAGE, "docs", jobs(&[0, 2, 3]))
        .await
        .unwrap_or_else(|e| panic!("{}", e.details));
    assert_eq!(pdfs.len(), 3);
    assert!(pdfs.iter().all(|p| p.starts_with(b"%PDF")));

    let err = render_all(&client, PAGE, "docs", jobs(&[0, 1, 2]))
        .await
        .expect_err("entry 1 fails");
    assert!(err.details.starts_with("docs[1]: "), "{}", err.details);

    let response = zip_response(&pdfs, vec!["a.pdf".into(); 3], "docs")
        .unwrap_or_else(|e| panic!("{}", e.details));
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/zip");
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let archive = zip::ZipArchive::new(Cursor::new(body)).unwrap();
    let mut names: Vec<_> = archive
        .file_names()
        .map(|n| n.unwrap().to_string())
        .collect();
    names.sort();
    assert_eq!(names, ["a-2.pdf", "a-3.pdf", "a.pdf"]);
}

#[test]
fn zip_names_stay_unique() {
    let mut used = HashSet::new();
    let names: Vec<String> = ["a.pdf", "a.pdf", "a-2.pdf", "a.pdf"]
        .into_iter()
        .enumerate()
        .map(|(i, name)| unique_name(name.to_string(), i, &mut used))
        .collect();
    assert_eq!(used.len(), 4, "{names:?}");
}

#[test]
fn design_setting_is_allow_listed_and_defaults_to_classic() {
    let sender = json!({"sender": {"name": "Sender", "address": "Street 1", "city": "12345 City"}});
    let settings: Settings = serde_json::from_value(sender.clone()).unwrap();
    let mut errors = Errors::default();
    let checked = check_settings(&settings, &mut errors);
    assert!(errors.0.is_empty(), "{:?}", errors.0);
    assert_eq!(checked.data["design"], "classic");

    for design in crate::invoice::DESIGNS {
        let mut input = sender.clone();
        input["design"] = json!(design);
        let settings: Settings = serde_json::from_value(input).unwrap();
        let mut errors = Errors::default();
        let checked = check_settings(&settings, &mut errors);
        assert!(errors.0.is_empty(), "{:?}", errors.0);
        assert_eq!(checked.data["design"], *design);
    }

    let mut input = sender;
    input["design"] = json!("untrusted-template");
    let settings: Settings = serde_json::from_value(input).unwrap();
    let mut errors = Errors::default();
    check_settings(&settings, &mut errors);
    assert!(errors.0.iter().any(|e| e.starts_with("settings.design:")));
}

#[tokio::test]
async fn renders_every_document_type() {
    for kind in Kind::ALL {
        let raw: Document = serde_json::from_value(json!({
                "number": "2026-001", "date": "2026-01-31", "reference": "R-2026-007", "referenceDate": "2026-01-02",
                "validUntil": "2026-02-28", "deliveryDate": "2026-02-03", "subject": "Betreff \"x\"",
                "dunningLevel": 2, "paymentDeadline": "2026-02-14", "invoices": [{"number": "R-2026-007", "date": "2026-01-02", "dueDate": "2026-01-16", "openAmount": 1000.5}], "fees": [{"description": "Mahngebühr", "amount": 5}], "interest": {"rate": 12.27, "from": "2026-01-17", "to": "2026-01-31", "amount": 4.71},
                "body": "Zeile 1\nZeile 2", "reason": "Falsche Menge", "intro": "Hallo", "closing": "Gruß",
                "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                "items": [
                    {"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19},
                    {"description": "Befreit", "quantity": 1, "unit": "pcs", "price": 10, "taxRate": 0},
                ],
            }))
            .unwrap();
        for design in crate::invoice::DESIGNS {
            let settings: Settings = serde_json::from_value(json!({
                    "design": design,
                    "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
                    "bank": {"iban": "DE89370400440532013000"},
                    "footer": "Muster GmbH · Musterstr. 1",
                }))
                .unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let doc = documents::check_document(kind, &raw, false, &mut errors);
            assert!(errors.0.is_empty(), "{:?}", errors.0);
            for watermark in [false, true] {
                let mut sd = s.data.clone();
                if watermark {
                    sd.as_object_mut()
                        .unwrap()
                        .insert("watermark".into(), "Entwurf".into());
                }
                let (data, assets) =
                    documents::build(kind, &settings, sd, &raw, doc.clone(), Vec::new());
                let pdf = render_pdf(kind.template(), data, assets)
                    .await
                    .unwrap_or_else(|e| panic!("{} ({design}): {}", kind.slug(), e.details));
                assert!(pdf.starts_with(b"%PDF"));
                let has_xml = pdf.windows(12).any(|w| w == b"factur-x.xml");
                assert_eq!(
                    has_xml,
                    kind == Kind::CreditNote,
                    "{} ({design})",
                    kind.slug()
                );
                if let Ok(dir) = std::env::var("PDF_OUT") {
                    std::fs::write(
                        format!(
                            "{dir}/{}-{design}{}.pdf",
                            kind.slug(),
                            if watermark { "-wm" } else { "" }
                        ),
                        pdf,
                    )
                    .unwrap();
                }
            }
        }
    }
}

/// Dunning letters: every level, design and language, with several pages of invoices, without fees
/// and interest, and without a bank account. The payment block carries the total and no XML is attached.
#[tokio::test]
async fn renders_dunning_letters_in_all_designs_and_languages() {
    let invoices: Vec<_> = (1..=40)
        .map(|n| json!({"number": format!("R-2026-{n:03}"), "date": "2026-01-02", "dueDate": "2026-01-16", "openAmount": 100.1}))
        .collect();
    let variants = [
        (
            "full",
            json!({"invoices": invoices[..2], "fees": [{"description": "Mahngebühr", "amount": 5}],
            "interest": {"rate": 12.27, "from": "2026-01-17", "to": "2026-01-31", "amount": 0.62}}),
        ),
        (
            "calc",
            json!({"date": "2026-08-10", "paymentDeadline": "2026-08-24",
            "invoices": [
                {"number": "R-2026-001", "date": "2026-06-02", "dueDate": "2026-06-16", "openAmount": 1000},
                {"number": "R-2026-002", "date": "2026-07-02", "dueDate": "2026-07-16", "openAmount": 250.5},
            ],
            "fees": [{"description": "Mahngebühr", "amount": 5}],
            "interest": {"debtor": "business"}}),
        ),
        ("many", json!({"invoices": invoices})),
        ("bare", json!({"invoices": invoices[..1]})),
    ];
    for design in crate::invoice::DESIGNS {
        for (english, iban) in [(false, "DE89370400440532013000"), (true, "")] {
            let settings: Settings = serde_json::from_value(json!({
                "design": design, "locale": if english { "en-de" } else { "de-de" },
                "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
                "bank": {"iban": iban},
            }))
            .unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            for level in 1..=3 {
                for (variant, extra) in &variants {
                    let mut raw = json!({
                        "number": "M-2026-001", "date": "2026-01-31", "dunningLevel": level,
                        "paymentDeadline": "2026-02-14",
                        "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                    });
                    raw.as_object_mut()
                        .unwrap()
                        .extend(extra.as_object().unwrap().clone());
                    let raw: Document = serde_json::from_value(raw).unwrap();
                    let doc = documents::check_document(Kind::Dunning, &raw, english, &mut errors);
                    assert!(errors.0.is_empty(), "{:?}", errors.0);
                    let (data, assets) = documents::build(
                        Kind::Dunning,
                        &settings,
                        s.data.clone(),
                        &raw,
                        doc,
                        Vec::new(),
                    );
                    let label = format!("{design} {english} level {level} {variant}");
                    assert!(assets.iter().all(|(name, _)| name != "xml"), "{label}");
                    assert_eq!(data["pay"]["qr"], !iban.is_empty(), "{label}");
                    let pdf = render_pdf(Kind::Dunning.template(), data, assets)
                        .await
                        .unwrap_or_else(|e| panic!("{label}: {}", e.details));
                    assert!(pdf.starts_with(b"%PDF"), "{label}");
                    assert!(!pdf.windows(12).any(|w| w == b"factur-x.xml"), "{label}");
                    if let Ok(dir) = std::env::var("PDF_OUT") {
                        let lang = if english { "en" } else { "de" };
                        std::fs::write(
                            format!("{dir}/dunning-{design}-{lang}-{level}-{variant}.pdf"),
                            pdf,
                        )
                        .unwrap();
                    }
                }
            }
        }
    }
}

/// Calculated default interest: split at the change of the base rate (1 July 2026: 1.52 %), the result
/// feeds the total and the payment block, and the PDF carries the machine-readable record.
#[tokio::test]
async fn dunning_interest_is_calculated_and_recorded() {
    let settings: Settings = serde_json::from_value(json!({
        "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
        "bank": {"iban": "DE89370400440532013000"},
    }))
    .unwrap();
    let raw: Document = serde_json::from_value(json!({
        "number": "M-1", "date": "2026-08-10", "dunningLevel": 2, "paymentDeadline": "2026-08-24",
        "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
        "invoices": [{"number": "R-1", "date": "2026-06-02", "dueDate": "2026-06-16", "openAmount": 1000}],
        "interest": {"debtor": "business"},
    }))
    .unwrap();
    let mut errors = Errors::default();
    let s = check_settings(&settings, &mut errors);
    let doc = documents::check_document(Kind::Dunning, &raw, false, &mut errors);
    assert!(errors.0.is_empty(), "{:?}", errors.0);
    // 2026-06-17 .. 2026-06-30: 14 days at 1.27 + 9; 2026-07-01 .. 2026-08-10: 41 days at 1.52 + 9
    let expected = (1000.0 * (0.1027 * 14.0 + 0.1052 * 41.0) / 365.0 * 100.0_f64).round() as i64;
    let interest = &data_interest(&doc);
    assert_eq!(interest["calculated"], true);
    assert_eq!(interest["rate"], "10,27\u{a0}% – 10,52\u{a0}%");
    assert_eq!(interest["base"], "1,27\u{a0}% – 1,52\u{a0}%");
    assert_eq!(doc["dunning"]["totalCents"], 100_000 + expected);
    let (data, assets) = documents::build(Kind::Dunning, &settings, s.data, &raw, doc, Vec::new());
    assert_eq!(data["pay"]["amount"], (100_000 + expected) as f64 / 100.0);
    let (_, record) = assets.iter().find(|(name, _)| name == "audit").unwrap();
    let record: serde_json::Value = serde_json::from_slice(record).unwrap();
    assert_eq!(record["mode"], "calculated");
    assert_eq!(record["documentNumber"], "M-1");
    assert_eq!(
        record["total"],
        format!("{}.{:02}", expected / 100, expected % 100)
    );
    let periods = &record["invoices"][0]["periods"];
    assert_eq!(periods[0]["from"], "2026-06-17");
    assert_eq!(periods[0]["to"], "2026-06-30");
    assert_eq!(periods[0]["days"], 14);
    assert_eq!(periods[0]["baseRatePercent"], "1.27");
    assert_eq!(periods[1]["ratePercent"], "10.52");
    assert!(periods[1]["source"]
        .as_str()
        .unwrap()
        .contains("Bundesbank"));
    let pdf = render_pdf(Kind::Dunning.template(), data, assets)
        .await
        .unwrap_or_else(|e| panic!("{}", e.details));
    assert!(pdf.windows(20).any(|w| w == b"dunning-interest.jso"));
}

fn data_interest(doc: &serde_json::Value) -> serde_json::Value {
    doc["dunning"]["interest"].clone()
}

#[test]
fn dunning_interest_calculation_reports_invalid_input() {
    let check = |interest: serde_json::Value, date: &str| {
        let raw: Document = serde_json::from_value(json!({
            "number": "M-1", "date": date, "dunningLevel": 2, "paymentDeadline": "2027-12-31",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "invoices": [{"number": "R-1", "date": "2026-06-02", "dueDate": "2026-06-16", "openAmount": 1000}],
            "interest": interest,
        }))
        .unwrap();
        let mut errors = Errors::default();
        documents::check_document(Kind::Dunning, &raw, false, &mut errors);
        errors.0
    };
    let errors = check(json!({"debtor": "someone"}), "2026-08-10");
    assert!(
        errors
            .iter()
            .any(|m| m.starts_with("document.interest.debtor:")),
        "{errors:?}"
    );
    let errors = check(
        json!({"debtor": "business", "rate": 5, "amount": 1}),
        "2026-08-10",
    );
    assert!(
        errors
            .iter()
            .any(|m| m.starts_with("document.interest.rate:")),
        "{errors:?}"
    );
    assert!(
        errors
            .iter()
            .any(|m| m.starts_with("document.interest.amount:")),
        "{errors:?}"
    );
    let errors = check(
        json!({"rate": 5, "from": "2026-01-01", "to": "2026-02-01", "amount": 1, "baseRate": 1}),
        "2026-08-10",
    );
    assert!(
        errors
            .iter()
            .any(|m| m.starts_with("document.interest.baseRate:")),
        "{errors:?}"
    );
    // the table ends on 2026-12-31 ...
    let errors = check(json!({"debtor": "business"}), "2027-01-20");
    assert!(
        errors
            .iter()
            .any(|m| m.contains("not known for 2027-01-01")),
        "{errors:?}"
    );
    // ... unless the caller sends the base rate
    assert!(check(
        json!({"debtor": "business", "baseRate": 1.77}),
        "2027-01-20"
    )
    .is_empty());
    // a period that has not started yet costs nothing and is not an error
    assert!(check(
        json!({"debtor": "consumer", "from": "2026-09-01", "to": "2026-09-30"}),
        "2026-08-10"
    )
    .is_empty());
}

/// The total of a dunning letter is computed in cents and also feeds the payment block (and the
/// amount of the EPC QR code).
#[test]
fn dunning_payment_block_uses_the_total() {
    let settings: Settings = serde_json::from_value(json!({
        "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
        "bank": {"iban": "DE89370400440532013000"},
    }))
    .unwrap();
    let raw: Document = serde_json::from_value(json!({
        "number": "M-1", "date": "2026-01-31", "dunningLevel": 1, "paymentDeadline": "2026-02-14",
        "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
        "invoices": [
            {"number": "R-1", "date": "2026-01-02", "dueDate": "2026-01-16", "openAmount": 100.10},
            {"number": "R-2", "date": "2026-01-03", "dueDate": "2026-01-17", "openAmount": 0.2},
        ],
        "fees": [{"description": "Mahngebühr", "amount": 5}],
        "interest": {"rate": 5, "from": "2026-01-17", "to": "2026-01-31", "amount": 0.37},
    }))
    .unwrap();
    let mut errors = Errors::default();
    let s = check_settings(&settings, &mut errors);
    let doc = documents::check_document(Kind::Dunning, &raw, false, &mut errors);
    assert!(errors.0.is_empty(), "{:?}", errors.0);
    let (data, _) = documents::build(Kind::Dunning, &settings, s.data, &raw, doc, Vec::new());
    assert_eq!(data["doc"]["dunning"]["total"], "105,67\u{a0}€");
    assert_eq!(data["pay"]["sum"], "105,67\u{a0}€");
    assert_eq!(data["pay"]["dueDate"], "14.02.2026");
    assert_eq!(data["pay"]["amount"], 105.67);
    assert_eq!(data["pay"]["qr"], true);
    assert!(data["pay"].get("days").is_none());
}

#[test]
fn dunning_letters_report_invalid_fields() {
    let raw: Document = serde_json::from_value(json!({
        "number": "M-1", "date": "2026-01-31", "dunningLevel": 0, "paymentDeadline": "soon",
        "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
        "invoices": [],
    }))
    .unwrap();
    let mut errors = Errors::default();
    documents::check_document(Kind::Dunning, &raw, false, &mut errors);
    for path in [
        "document.dunningLevel:",
        "document.invoices:",
        "document.paymentDeadline:",
    ] {
        assert!(
            errors.0.iter().any(|e| e.starts_with(path)),
            "{path} {:?}",
            errors.0
        );
    }
}

/// Timing benchmark: `cargo test --release bench_render -- --ignored --nocapture`.
#[tokio::test]
#[ignore]
async fn bench_render() {
    for design in crate::invoice::DESIGNS {
        let settings: Settings = serde_json::from_value(json!({
                "design": design,
                "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
                "bank": {"iban": "DE89370400440532013000"},
            }))
            .unwrap();
        for count in [3usize, 60] {
            let items: Vec<_> = (0..count)
                    .map(|i| json!({"description": format!("Position {i}"), "quantity": 2, "unit": "h", "price": 95, "taxRate": 19}))
                    .collect();
            let raw: Invoice = serde_json::from_value(json!({
                    "number": "2026-001", "date": "2026-01-31", "deliveryDate": "2026-01-30", "dueDate": "2026-02-14",
                    "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                    "items": items,
                }))
                .unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let invoice = check_invoice(&raw, "invoice", &mut errors);
            assert!(errors.0.is_empty(), "{:?}", errors.0);
            let mut times = Vec::new();
            for iteration in 0..25 {
                let (data, assets) =
                    invoice_data(&settings, s.data.clone(), &raw, invoice.clone(), Vec::new());
                let started = std::time::Instant::now();
                let pdf = render_pdf(INVOICE_TEMPLATE, data, assets)
                    .await
                    .unwrap_or_else(|e| panic!("{}", e.details));
                if iteration == 0 {
                    if let Ok(dir) = std::env::var("PDF_OUT") {
                        std::fs::write(format!("{dir}/bench-{design}-{count}-items.pdf"), &pdf)
                            .unwrap();
                    }
                }
                times.push((started.elapsed().as_secs_f64() * 1000.0, pdf.len()));
            }
            times.remove(0);
            times.sort_by(|a, b| a.0.total_cmp(&b.0));
            println!(
                    "BENCH design={design} items={count} median={:.1}ms min={:.1}ms max={:.1}ms size={}",
                    times[times.len() / 2].0,
                    times[0].0,
                    times[times.len() - 1].0,
                    times[0].1
                );

            let client = Client {
                id: "bench".into(),
                kind: store::Kind::Paid,
                plan: "bench".into(),
                limit: 1000,
                created: None,
            };
            let jobs = || {
                (0..20)
                    .map(|_| {
                        invoice_data(&settings, s.data.clone(), &raw, invoice.clone(), Vec::new())
                    })
                    .collect::<Vec<_>>()
            };
            let started = std::time::Instant::now();
            for (data, assets) in jobs() {
                render_pdf(INVOICE_TEMPLATE, data, assets)
                    .await
                    .unwrap_or_else(|e| panic!("{}", e.details));
            }
            let sequential = started.elapsed().as_secs_f64() * 1000.0;
            let started = std::time::Instant::now();
            render_all(&client, INVOICE_TEMPLATE, "invoices", jobs())
                .await
                .unwrap_or_else(|e| panic!("{}", e.details));
            println!(
                    "BENCH design={design} bulk 20 x items={count}: sequential={sequential:.0}ms parallel={:.0}ms",
                    started.elapsed().as_secs_f64() * 1000.0
                );
        }
    }
}

fn stamp() -> serde_json::Value {
    use base64::Engine as _;
    json!({"base64": base64::engine::general_purpose::STANDARD.encode(crate::postage::test_png(472, 283, None))})
}

/// PNG, SVG and PDF signatures are all printed on every document type and are not rejected.
#[tokio::test]
async fn renders_every_document_type_with_a_signature() {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><path d="M5 60 C 40 0, 70 90, 110 30 S 200 70, 290 20" stroke="#123" fill="none" stroke-width="3"/></svg>"##;
    let pdf_signature = render_pdf(
            "#set document(date: datetime(year: 2026, month: 1, day: 1))\n#set page(width: 60mm, height: 15mm, margin: 0pt)\n#curve(stroke: 1.5pt, curve.move((2mm, 10mm)), curve.cubic((15mm, 0mm), (30mm, 14mm), (58mm, 3mm)))",
            json!({}),
            Vec::new(),
        )
        .await
        .unwrap_or_else(|e| panic!("{}", e.details));
    let signatures = [
        ("png", crate::postage::test_png(300, 80, None)),
        ("svg", svg.as_bytes().to_vec()),
        ("pdf", pdf_signature),
    ];
    for (format, bytes) in signatures {
        for kind in Kind::ALL {
            let settings: Settings = serde_json::from_value(json!({
                    "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
                    "signature": {"base64": B64.encode(&bytes)},
                }))
                .unwrap();
            let raw: Document = serde_json::from_value(json!({
                    "number": "2026-001", "date": "2026-01-31", "reference": "R-2026-007", "referenceDate": "2026-01-02",
                    "validUntil": "2026-02-28", "deliveryDate": "2026-02-03", "subject": "Betreff", "body": "Text",
                    "dunningLevel": 2, "paymentDeadline": "2026-02-14", "invoices": [{"number": "R-2026-007", "date": "2026-01-02", "dueDate": "2026-01-16", "openAmount": 1000.5}], "fees": [{"description": "Mahngebühr", "amount": 5}], "interest": {"rate": 12.27, "from": "2026-01-17", "to": "2026-01-31", "amount": 4.71},
                    "reason": "Falsche Menge", "closing": "Mit freundlichen Grüßen",
                    "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                    "items": [{"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19}],
                }))
                .unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let doc = documents::check_document(kind, &raw, false, &mut errors);
            assert!(errors.0.is_empty(), "{format} {:?}", errors.0);
            let assets = settings_assets(&s).unwrap_or_else(|e| panic!("{}", e.details));
            assert!(assets.iter().any(|(name, _)| name == "signature"));
            let (data, assets) =
                documents::build(kind, &settings, s.data.clone(), &raw, doc, assets);
            let pdf = render_pdf(kind.template(), data, assets)
                .await
                .unwrap_or_else(|e| panic!("{format} {}: {}", kind.slug(), e.details));
            assert!(pdf.starts_with(b"%PDF"));
            if let Ok(dir) = std::env::var("PDF_OUT") {
                std::fs::write(format!("{dir}/{}-signature-{format}.pdf", kind.slug()), pdf)
                    .unwrap();
            }
        }
    }
}

#[tokio::test]
async fn renders_an_invoice_with_a_signature() {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let png = crate::postage::test_png(300, 80, None);
    let settings: Settings = serde_json::from_value(json!({
        "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
        "closing": "Danke!",
        "signature": {"base64": B64.encode(&png)},
    }))
    .unwrap();
    let invoice: Invoice = serde_json::from_value(json!({
            "number": "2026-001", "date": "2026-01-31",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 1, "unit": "h", "price": 95, "taxRate": 19}],
        }))
        .unwrap();
    let mut errors = Errors::default();
    let s = check_settings(&settings, &mut errors);
    let checked = check_invoice(&invoice, "invoice", &mut errors);
    assert!(errors.0.is_empty(), "{:?}", errors.0);
    let (data, assets) = invoice_data(
        &settings,
        s.data.clone(),
        &invoice,
        checked,
        settings_assets(&s).unwrap_or_else(|e| panic!("{}", e.details)),
    );
    let pdf = render_pdf(INVOICE_TEMPLATE, data, assets)
        .await
        .unwrap_or_else(|e| panic!("{}", e.details));
    assert!(pdf.starts_with(b"%PDF"));
    if let Ok(dir) = std::env::var("PDF_OUT") {
        std::fs::write(format!("{dir}/invoice-signature.pdf"), pdf).unwrap();
    }
}

#[test]
fn rejects_signatures_that_are_not_images_or_pdfs() {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    for (bytes, ok) in [
        (b"hello world".to_vec(), false),
        (b"MZ\x90\x00 binary".to_vec(), false),
        (vec![b'a'; 301 * 1024], false),
        (
            b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>".to_vec(),
            true,
        ),
    ] {
        let settings: Settings = serde_json::from_value(json!({
                "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
                "signature": {"base64": B64.encode(&bytes)},
            }))
            .unwrap();
        let mut errors = Errors::default();
        check_settings(&settings, &mut errors);
        assert_eq!(errors.0.is_empty(), ok, "{:?}", errors.0);
    }
    let settings: Settings =
        serde_json::from_value(json!({"signature": {"base64": "***"}})).unwrap();
    let mut errors = Errors::default();
    check_settings(&settings, &mut errors);
    assert!(errors.0.iter().any(|m| m.starts_with("settings.signature")));
}

#[tokio::test]
async fn renders_every_document_type_with_a_stamp() {
    for kind in Kind::ALL {
        let settings: Settings = serde_json::from_value(json!({
                "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
                "bank": {"iban": "DE89370400440532013000"},
            }))
            .unwrap();
        let raw: Document = serde_json::from_value(json!({
                "number": "2026-001", "date": "2026-01-31", "reference": "R-2026-007", "referenceDate": "2026-01-02",
                "validUntil": "2026-02-28", "deliveryDate": "2026-02-03", "subject": "Betreff",
                "dunningLevel": 2, "paymentDeadline": "2026-02-14", "invoices": [{"number": "R-2026-007", "date": "2026-01-02", "dueDate": "2026-01-16", "openAmount": 1000.5}], "fees": [{"description": "Mahngebühr", "amount": 5}], "interest": {"rate": 12.27, "from": "2026-01-17", "to": "2026-01-31", "amount": 4.71},
                "body": "Zeile 1\nZeile 2", "reason": "Falsche Menge", "intro": "Hallo", "closing": "Gruß",
                "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                "items": [{"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19}],
                "postage": stamp(),
            }))
            .unwrap();
        let mut errors = Errors::default();
        let s = check_settings(&settings, &mut errors);
        let doc = documents::check_document(kind, &raw, false, &mut errors);
        assert!(errors.0.is_empty(), "{:?}", errors.0);
        assert_eq!(doc["postage"]["widthMm"], 40.0);
        let (data, assets) =
            documents::build(kind, &settings, s.data.clone(), &raw, doc, Vec::new());
        assert!(
            assets.iter().any(|(name, _)| name == "postage"),
            "{}",
            kind.slug()
        );
        let pdf = render_pdf(kind.template(), data, assets)
            .await
            .unwrap_or_else(|e| panic!("{}: {}", kind.slug(), e.details));
        assert!(pdf.starts_with(b"%PDF"));
        if let Ok(dir) = std::env::var("PDF_OUT") {
            std::fs::write(format!("{dir}/{}-stamp.pdf", kind.slug()), pdf).unwrap();
        }
    }
}

#[test]
fn bulk_entries_carry_their_own_stamp() {
    let item = |n: &str, with_stamp: bool| {
        let mut v = json!({
            "number": n, "date": "2026-01-31",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 1, "unit": "h", "price": 95, "taxRate": 19}],
        });
        if with_stamp {
            v["postage"] = stamp();
        }
        v
    };
    let req: InvoiceBulkRequest = serde_json::from_value(json!({
            "settings": {"sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"}},
            "invoices": [item("1", true), item("2", false)],
        }))
        .unwrap();
    let mut errors = Errors::default();
    let checked: Vec<_> = req
        .invoices
        .iter()
        .enumerate()
        .map(|(i, inv)| check_invoice(inv, &format!("invoices[{i}]"), &mut errors))
        .collect();
    assert!(errors.0.is_empty(), "{:?}", errors.0);
    assert_eq!(checked[0]["postage"]["widthMm"], 40.0);
    assert!(checked[1].get("postage").is_none());

    let docs: DocumentBulkRequest = serde_json::from_value(json!({
            "settings": {"sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"}},
            "type": "letter", "documents": [{"number": "1", "date": "2026-01-31", "recipient": {"name": "K", "address": "W 1", "city": "5 S"}, "postage": stamp()}],
        }))
        .unwrap();
    assert!(docs.documents[0].postage.is_some());
}

#[tokio::test]
async fn renders_invoice_with_a_stamp() {
    let settings: Settings = serde_json::from_value(json!({
            "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
            "bank": {"iban": "DE89370400440532013000"},
        }))
        .unwrap();
    let raw: Invoice = serde_json::from_value(json!({
            "number": "2026-001", "date": "2026-01-31", "deliveryDate": "2026-01-30", "dueDate": "2026-02-14",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19}],
            "postage": stamp(),
        }))
        .unwrap();
    let mut errors = Errors::default();
    let s = check_settings(&settings, &mut errors);
    let invoice = check_invoice(&raw, "invoice", &mut errors);
    assert!(errors.0.is_empty(), "{:?}", errors.0);
    let (data, assets) = invoice_data(&settings, s.data, &raw, invoice, Vec::new());
    let pdf = render_pdf(INVOICE_TEMPLATE, data, assets)
        .await
        .unwrap_or_else(|e| panic!("{}", e.details));
    assert!(pdf.starts_with(b"%PDF"));
    if let Ok(dir) = std::env::var("PDF_OUT") {
        std::fs::write(format!("{dir}/invoice-stamp.pdf"), pdf).unwrap();
    }
}

/// Fixed e-invoice corpus for the Mustang conformance check in CI (`docs/epics/E01-einvoice-conformance-ci.md`).
/// With `PDF_OUT=<dir>` the PDFs are written as `<dir>/einvoice-<name>.pdf`; without it the test still checks
/// that every document carries a complete e-invoice XML (no `invoice-draft.xml`).
#[tokio::test]
async fn renders_einvoice_conformance_corpus() {
    let sender = json!({
        "name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt",
        "email": "rechnung@muster.example", "phone": "+49 30 123456", "contactName": "Erika Muster",
        "vatId": "DE123456789", "taxNr": "12/345/67890",
    });
    let bank =
        json!({"name": "Musterbank", "iban": "DE89370400440532013000", "bic": "COBADEFFXXX"});
    let recipient = json!({
        "name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt",
        "vatId": "DE987654321", "email": "einkauf@kunde.example", "buyerReference": "04011000-12345-34",
    });
    let mixed_items = json!([
        {"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19},
        {"description": "Fachbuch", "quantity": 3, "unit": "pcs", "price": 24.9, "taxRate": 7},
        {"description": "Wartungspauschale", "quantity": 1, "unit": "flat", "price": 149.99, "taxRate": 19},
    ]);
    let exempt_items = json!([
        {"description": "Beratung", "quantity": 2.5, "unit": "h", "price": 80, "taxRate": 19},
        {"description": "Innergemeinschaftliche Lieferung", "quantity": 12, "unit": "kg", "price": 3.333, "taxRate": 0},
    ]);
    let settings = |profile: &str, locale: &str| {
        json!({
            "sender": sender, "bank": bank, "locale": locale, "einvoiceProfile": profile, "paymentDays": 30,
            "exemptionReason": "Steuerfrei nach § 4 Nr. 1b UStG",
        })
    };
    let invoice = |items: &serde_json::Value| {
        json!({
            "number": "2026-001", "date": "2026-01-31", "recipient": recipient, "items": items,
        })
    };
    let service_period_invoice = |items: &serde_json::Value| {
        let mut value = invoice(items);
        value["serviceDateFrom"] = json!("2026-01-01");
        value["serviceDateTo"] = json!("2026-01-31");
        value["dueDate"] = json!("2026-03-02");
        value
    };
    let credit_note = |items: &serde_json::Value| {
        json!({
            "number": "G-2026-001", "date": "2026-02-10", "reference": "2026-001", "referenceDate": "2026-01-31",
            "reason": "Falsche Menge", "recipient": recipient, "items": items,
        })
    };

    // (file name, e-invoice file expected in the PDF, settings, credit note?, document)
    let corpus = [
        (
            "en16931-mixed-rates",
            "factur-x.xml",
            settings("en16931", "de-de"),
            false,
            invoice(&mixed_items),
        ),
        (
            "en16931-exempt",
            "factur-x.xml",
            settings("en16931", "de-de"),
            false,
            invoice(&exempt_items),
        ),
        (
            "en16931-english",
            "factur-x.xml",
            settings("en16931", "en-de"),
            false,
            invoice(&mixed_items),
        ),
        (
            "en16931-service-period",
            "factur-x.xml",
            settings("en16931", "de-de"),
            false,
            service_period_invoice(&mixed_items),
        ),
        (
            "xrechnung-mixed-rates",
            "xrechnung.xml",
            settings("xrechnung", "de-de"),
            false,
            invoice(&mixed_items),
        ),
        (
            "xrechnung-service-period",
            "xrechnung.xml",
            settings("xrechnung", "de-de"),
            false,
            service_period_invoice(&mixed_items),
        ),
        (
            "xrechnung-exempt",
            "xrechnung.xml",
            settings("xrechnung", "de-de"),
            false,
            invoice(&exempt_items),
        ),
        (
            "credit-note-en16931",
            "factur-x.xml",
            settings("en16931", "de-de"),
            true,
            credit_note(&mixed_items),
        ),
        (
            "credit-note-xrechnung",
            "xrechnung.xml",
            settings("xrechnung", "de-de"),
            true,
            credit_note(&exempt_items),
        ),
    ];
    for (name, attached, settings, is_credit_note, document) in corpus {
        for design in crate::invoice::DESIGNS {
            let mut raw_settings = settings.clone();
            raw_settings["design"] = json!(design);
            let settings: Settings = serde_json::from_value(raw_settings).unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let pdf = if is_credit_note {
                let raw: Document = serde_json::from_value(document.clone()).unwrap();
                let doc = documents::check_document(
                    Kind::CreditNote,
                    &raw,
                    settings.locale.as_deref() == Some("en-de"),
                    &mut errors,
                );
                assert!(errors.0.is_empty(), "{name}: {:?}", errors.0);
                let (data, assets) =
                    documents::build(Kind::CreditNote, &settings, s.data, &raw, doc, Vec::new());
                render_pdf(Kind::CreditNote.template(), data, assets).await
            } else {
                let raw: Invoice = serde_json::from_value(document.clone()).unwrap();
                let invoice = check_invoice(&raw, "invoice", &mut errors);
                assert!(errors.0.is_empty(), "{name}: {:?}", errors.0);
                let (data, assets) = invoice_data(&settings, s.data, &raw, invoice, Vec::new());
                render_pdf(INVOICE_TEMPLATE, data, assets).await
            }
            .unwrap_or_else(|e| panic!("{name} ({design}): {}", e.details));
            assert!(pdf.starts_with(b"%PDF"), "{name} ({design})");
            let contains = |needle: &[u8]| pdf.windows(needle.len()).any(|w| w == needle);
            assert!(
                contains(attached.as_bytes()),
                "{name} ({design}): {attached} is not attached"
            );
            assert!(
                !contains(b"invoice-draft.xml"),
                "{name} ({design}): the e-invoice XML is only a draft"
            );
            if let Ok(dir) = std::env::var("PDF_OUT") {
                std::fs::write(format!("{dir}/einvoice-{name}-{design}.pdf"), pdf).unwrap();
            }
        }
    }
}

#[tokio::test]
async fn renders_invoice_with_and_without_watermark() {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let raw: Invoice = serde_json::from_value(json!({
            "number": "2026-001", "date": "2026-01-31", "deliveryDate": "2026-01-30", "dueDate": "2026-02-14",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19}],
        }))
        .unwrap();
    for design in crate::invoice::DESIGNS {
        let settings: Settings = serde_json::from_value(json!({
                "design": design,
                "logo": {"base64": B64.encode(include_bytes!("../../../frontend/public/logo.svg"))},
                "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
                "bank": {"iban": "DE89370400440532013000"},
            }))
            .unwrap();
        for watermark in [false, true] {
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let invoice = check_invoice(&raw, "invoice", &mut errors);
            assert!(errors.0.is_empty(), "{:?}", errors.0);
            let mut sd = s.data.clone();
            if watermark {
                sd.as_object_mut()
                    .unwrap()
                    .insert("watermark".into(), "Entwurf".into());
            }
            let assets = settings_assets(&s).unwrap_or_else(|e| panic!("{}", e.details));
            let (data, assets) = invoice_data(&settings, sd, &raw, invoice, assets);
            let (pdf, zones) = render_pdf_with_zones(INVOICE_TEMPLATE, data, assets)
                .await
                .unwrap_or_else(|e| panic!("{design}: {}", e.details));
            assert!(pdf.starts_with(b"%PDF"));
            let details = zones.iter().find(|zone| zone.zone == 3).unwrap();
            let items = zones.iter().find(|zone| zone.zone == 4).unwrap();
            for zone in [details, items] {
                assert_eq!(zone.page, 1);
                assert_eq!(zone.x, 25.0);
                assert_eq!(zone.w, 165.0);
                assert!(zone.h >= 4.0);
            }
            assert!(details.y < items.y, "{design}: details must precede items");
            assert!(
                details.y + details.h <= items.y + 0.01,
                "{design}: detail and item frames overlap"
            );
            if let Ok(dir) = std::env::var("PDF_OUT") {
                std::fs::write(
                    format!(
                        "{dir}/invoice-{design}{}.pdf",
                        if watermark { "-wm" } else { "" }
                    ),
                    pdf,
                )
                .unwrap();
            }
        }
    }
}

// ------------------------------------------------------------ Deterministic PDF output

/// SHA-256 of one PDF for every document type, design, watermark setting and e-invoice profile, labelled.
/// The input is fixed; the output must not depend on the current time, the request counter or the process.
async fn determinism_hashes() -> Vec<(String, String)> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use sha2::{Digest, Sha256};

    let hash = |pdf: &[u8]| {
        // Document info and XMP dates come from the document date (2026-01-31), never from the clock.
        let contains = |needle: &[u8]| pdf.windows(needle.len()).any(|w| w == needle);
        assert!(contains(b"/CreationDate(D:20260131000000Z)"));
        assert!(contains(b"<xmp:CreateDate>2026-01-31T00:00:00Z"));
        Sha256::digest(pdf)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    let sender = json!({
        "name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt",
        "email": "a@b.de", "vatId": "DE123456789",
    });
    let logo = B64.encode(include_bytes!("../../../frontend/public/logo.svg"));
    let recipient =
        json!({"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"});
    let items = json!([
        {"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19},
        {"description": "Befreit", "quantity": 1, "unit": "pcs", "price": 10, "taxRate": 0},
    ]);
    let mut hashes = Vec::new();

    let raw_invoice: Invoice = serde_json::from_value(json!({
        "number": "2026-001", "date": "2026-01-31", "deliveryDate": "2026-01-30", "dueDate": "2026-02-14",
        "recipient": recipient, "items": items,
    }))
    .unwrap();
    let raw_document: Document = serde_json::from_value(json!({
        "number": "2026-001", "date": "2026-01-31", "reference": "R-2026-007", "referenceDate": "2026-01-02",
        "validUntil": "2026-02-28", "deliveryDate": "2026-02-03", "subject": "Betreff", "body": "Zeile 1\nZeile 2",
        "dunningLevel": 2, "paymentDeadline": "2026-02-14", "invoices": [{"number": "R-2026-007", "date": "2026-01-02", "dueDate": "2026-01-16", "openAmount": 1000.5}], "fees": [{"description": "Mahngebühr", "amount": 5}], "interest": {"rate": 12.27, "from": "2026-01-17", "to": "2026-01-31", "amount": 4.71},
        "reason": "Falsche Menge", "intro": "Hallo", "closing": "Gruß",
        "recipient": recipient, "items": items,
    }))
    .unwrap();

    let raw_calculated: Document = serde_json::from_value(json!({
        "number": "M-1", "date": "2026-01-31", "dunningLevel": 2, "paymentDeadline": "2026-02-14",
        "invoices": [{"number": "R-1", "date": "2025-06-02", "dueDate": "2025-06-16", "openAmount": 1000.5}],
        "interest": {"debtor": "business", "to": "2026-01-31"},
        "recipient": recipient,
    }))
    .unwrap();

    for design in crate::invoice::DESIGNS {
        for watermark in [false, true] {
            let label = format!("{design}{}", if watermark { "-wm" } else { "" });
            let settings = |profile: &str| -> Settings {
                serde_json::from_value(json!({
                    "design": design, "einvoiceProfile": profile, "logo": {"base64": logo}, "sender": sender,
                    "bank": {"iban": "DE89370400440532013000"}, "footer": "Muster GmbH · Musterstr. 1",
                    "exemptionReason": "Steuerfrei nach § 4 Nr. 1b UStG",
                }))
                .unwrap()
            };
            let with_watermark = |data: serde_json::Value| {
                let mut data = data;
                if watermark {
                    data.as_object_mut()
                        .unwrap()
                        .insert("watermark".into(), "Entwurf".into());
                }
                data
            };

            for profile in ["en16931", "xrechnung"] {
                let settings = settings(profile);
                let mut errors = Errors::default();
                let s = check_settings(&settings, &mut errors);
                let invoice = check_invoice(&raw_invoice, "invoice", &mut errors);
                assert!(errors.0.is_empty(), "{:?}", errors.0);
                let assets = settings_assets(&s).unwrap_or_else(|e| panic!("{}", e.details));
                let (data, assets) = invoice_data(
                    &settings,
                    with_watermark(s.data.clone()),
                    &raw_invoice,
                    invoice,
                    assets,
                );
                let pdf = render_pdf(INVOICE_TEMPLATE, data, assets)
                    .await
                    .unwrap_or_else(|e| panic!("invoice {profile} ({label}): {}", e.details));
                assert!(pdf.starts_with(b"%PDF"));
                hashes.push((format!("invoice-{profile}-{label}"), hash(&pdf)));
            }

            let settings = settings("en16931");
            for kind in Kind::ALL {
                let mut errors = Errors::default();
                let s = check_settings(&settings, &mut errors);
                let doc = documents::check_document(kind, &raw_document, false, &mut errors);
                assert!(errors.0.is_empty(), "{:?}", errors.0);
                let assets = settings_assets(&s).unwrap_or_else(|e| panic!("{}", e.details));
                let (data, assets) = documents::build(
                    kind,
                    &settings,
                    with_watermark(s.data.clone()),
                    &raw_document,
                    doc,
                    assets,
                );
                let pdf = render_pdf(kind.template(), data, assets)
                    .await
                    .unwrap_or_else(|e| panic!("{} ({label}): {}", kind.slug(), e.details));
                assert!(pdf.starts_with(b"%PDF"));
                hashes.push((format!("{}-{label}", kind.slug()), hash(&pdf)));
            }

            // Calculated default interest also writes the audit record (JSON attachment).
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let doc = documents::check_document(Kind::Dunning, &raw_calculated, false, &mut errors);
            assert!(errors.0.is_empty(), "{:?}", errors.0);
            let assets = settings_assets(&s).unwrap_or_else(|e| panic!("{}", e.details));
            let (data, assets) = documents::build(
                Kind::Dunning,
                &settings,
                with_watermark(s.data.clone()),
                &raw_calculated,
                doc,
                assets,
            );
            let pdf = render_pdf(Kind::Dunning.template(), data, assets)
                .await
                .unwrap_or_else(|e| panic!("dunning-calculated ({label}): {}", e.details));
            hashes.push((format!("dunning-calculated-{label}"), hash(&pdf)));
        }
    }
    hashes
}

/// Prints the hashes for `pdf_output_is_identical_across_processes`; not a test on its own.
#[tokio::test]
#[ignore]
async fn determinism_probe() {
    for (label, hash) in determinism_hashes().await {
        println!("DETERMINISM {label} {hash}");
    }
}

#[tokio::test]
async fn pdf_output_is_identical_for_identical_input() {
    let first = determinism_hashes().await;
    assert!(
        first.len() >= crate::invoice::DESIGNS.len() * 2 * 7,
        "the matrix shrank: {}",
        first.len()
    );
    let unique: std::collections::HashSet<_> = first.iter().map(|(_, hash)| hash).collect();
    assert_eq!(
        unique.len(),
        first.len(),
        "every variant is a different PDF"
    );
    // A second pass reuses the warm compiler (cache, request counter), a third one follows other renders.
    for pass in 2..=3 {
        let again = determinism_hashes().await;
        for (a, b) in first.iter().zip(&again) {
            assert_eq!(a, b, "{} differs in render pass {pass}", a.0);
        }
    }
}

/// Starts the test binary twice as fresh processes and compares their PDF hashes with this process.
#[tokio::test]
async fn pdf_output_is_identical_across_processes() {
    let exe = std::env::current_exe().unwrap();
    let probe = format!(
        "{}::determinism_probe",
        module_path!().split_once("::").unwrap().1
    );
    let expected: Vec<String> = determinism_hashes()
        .await
        .into_iter()
        .map(|(label, hash)| format!("DETERMINISM {label} {hash}"))
        .collect();
    for run in 1..=2 {
        let output = std::process::Command::new(&exe)
            .args([probe.as_str(), "--exact", "--ignored", "--nocapture"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "probe process {run} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout
            .lines()
            .filter(|l| l.starts_with("DETERMINISM "))
            .collect();
        assert_eq!(lines.len(), expected.len(), "probe process {run}: {stdout}");
        for (line, want) in lines.iter().zip(&expected) {
            assert_eq!(line, want, "differs in fresh process {run}");
        }
    }
}

// ------------------------------------------------------------ OpenAPI spec (docs/openapi.yaml)

fn spec() -> serde_json::Value {
    crate::openapi::spec()
}

/// All request examples of an operation: `(name, body)`.
fn spec_examples(spec: &serde_json::Value, path: &str) -> Vec<(String, serde_json::Value)> {
    let examples =
        &spec["paths"][path]["post"]["requestBody"]["content"]["application/json"]["examples"];
    let examples = examples
        .as_object()
        .unwrap_or_else(|| panic!("{path} has request examples"));
    assert!(!examples.is_empty(), "{path} has request examples");
    examples
        .iter()
        .map(|(name, example)| (format!("{path} {name}"), example["value"].clone()))
        .collect()
}

fn enum_values(schema: &serde_json::Value) -> Vec<String> {
    schema["enum"]
        .as_array()
        .expect("an enum")
        .iter()
        .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
        .collect()
}

/// Validates an invoice request the way the handlers do and renders it.
async fn render_invoice_example(
    name: &str,
    settings: serde_json::Value,
    invoice: serde_json::Value,
) {
    let settings: Settings =
        serde_json::from_value(settings).unwrap_or_else(|e| panic!("{name}: {e}"));
    let invoice: Invoice =
        serde_json::from_value(invoice).unwrap_or_else(|e| panic!("{name}: {e}"));
    let mut errors = Errors::default();
    let checked_settings = check_settings(&settings, &mut errors);
    let checked = check_invoice(&invoice, "invoice", &mut errors);
    assert!(errors.0.is_empty(), "{name}: {:?}", errors.0);
    let (data, assets) = invoice_data(
        &settings,
        checked_settings.data,
        &invoice,
        checked,
        Vec::new(),
    );
    let pdf = render_pdf(INVOICE_TEMPLATE, data, assets)
        .await
        .unwrap_or_else(|e| panic!("{name}: {}", e.details));
    assert!(pdf.starts_with(b"%PDF"), "{name}");
}

/// Validates a document request the way the handlers do and renders it.
async fn render_document_example(
    name: &str,
    kind: &str,
    settings: serde_json::Value,
    document: serde_json::Value,
) {
    let kind = Kind::parse(kind).unwrap_or_else(|| panic!("{name}: unknown type {kind}"));
    let settings: Settings =
        serde_json::from_value(settings).unwrap_or_else(|e| panic!("{name}: {e}"));
    let document: Document =
        serde_json::from_value(document).unwrap_or_else(|e| panic!("{name}: {e}"));
    let mut errors = Errors::default();
    let checked_settings = check_settings(&settings, &mut errors);
    assert!(errors.0.is_empty(), "{name}: {:?}", errors.0);
    let (data, assets) = prepare_document(
        kind,
        &settings,
        checked_settings.data,
        Vec::new(),
        &document,
        "document",
        &mut errors,
    )
    .unwrap_or_else(|| panic!("{name}: {:?}", errors.0));
    let pdf = render_pdf(kind.template(), data, assets)
        .await
        .unwrap_or_else(|e| panic!("{name}: {}", e.details));
    assert!(pdf.starts_with(b"%PDF"), "{name}");
}

/// The request examples of `docs/openapi.yaml` are real requests: every one passes the validation
/// of the handlers and renders a PDF, so the spec cannot drift from the code unnoticed.
#[tokio::test]
async fn openapi_request_examples_are_accepted() {
    let spec = spec();

    for (name, body) in spec_examples(&spec, "/v1/invoices") {
        render_invoice_example(&name, body["settings"].clone(), body["invoice"].clone()).await;
    }
    for (name, body) in spec_examples(&spec, "/v1/invoices/bulk") {
        let invoices = body["invoices"].as_array().expect("invoices");
        assert!(!invoices.is_empty(), "{name}");
        for (i, invoice) in invoices.iter().enumerate() {
            render_invoice_example(
                &format!("{name}[{i}]"),
                body["settings"].clone(),
                invoice.clone(),
            )
            .await;
        }
    }

    let mut single_types = Vec::new();
    for (name, body) in spec_examples(&spec, "/v1/documents") {
        let kind = body["type"].as_str().expect("type").to_string();
        render_document_example(
            &name,
            &kind,
            body["settings"].clone(),
            body["document"].clone(),
        )
        .await;
        single_types.push(kind);
    }
    for kind in Kind::ALL {
        assert!(
            single_types.contains(&kind.slug().to_string()),
            "/v1/documents has no example for {}",
            kind.slug()
        );
    }
    for (name, body) in spec_examples(&spec, "/v1/documents/bulk") {
        let kind = body["type"].as_str().expect("type").to_string();
        let documents = body["documents"].as_array().expect("documents");
        assert!(!documents.is_empty(), "{name}");
        for (i, document) in documents.iter().enumerate() {
            render_document_example(
                &format!("{name}[{i}]"),
                &kind,
                body["settings"].clone(),
                document.clone(),
            )
            .await;
        }
    }
}

/// The limits written into the `#[schema(...)]` attributes are the ones the validation enforces
/// (attributes only take literals, so they cannot use the constants directly).
#[test]
fn openapi_limits_match_the_validation() {
    let spec = spec();
    let schemas = &spec["components"]["schemas"];

    assert_eq!(
        schemas["Invoice"]["properties"]["items"]["maxItems"],
        crate::invoice::MAX_ITEMS
    );
    assert_eq!(
        schemas["Document"]["properties"]["items"]["maxItems"],
        crate::invoice::MAX_ITEMS
    );
    for (schema, property) in [
        ("Sender", "name"),
        ("Recipient", "name"),
        ("Bank", "iban"),
        ("Invoice", "number"),
        ("Document", "subject"),
    ] {
        assert_eq!(
            schemas[schema]["properties"][property]["maxLength"],
            crate::invoice::MAX_SHORT,
            "{schema}.{property}"
        );
    }
    for (schema, property) in [
        ("Settings", "footer"),
        ("Settings", "closing"),
        ("Item", "description"),
        ("Document", "reason"),
    ] {
        assert_eq!(
            schemas[schema]["properties"][property]["maxLength"],
            crate::invoice::MAX_LONG,
            "{schema}.{property}"
        );
    }
    let kinds: Vec<&str> = Kind::ALL.iter().map(|k| k.slug()).collect();
    assert_eq!(enum_values(&schemas["DocumentType"]), kinds);
}

/// Every error code the handlers answer with is documented in the `Error` schema.
#[test]
fn openapi_lists_every_error_code() {
    let spec = spec();
    let documented = enum_values(&spec["components"]["schemas"]["Error"]["properties"]["error"]);
    let mut used = std::collections::BTreeSet::new();
    for source in [include_str!("../main.rs"), include_str!("../v1.rs")] {
        // `ApiError::new(StatusCode::X, "code", ...)`, possibly spread over several lines.
        let production_code = source.split("#[cfg(test)]").next().unwrap_or(source);
        for call in production_code.split("ApiError::new(").skip(1) {
            if let Some(code) = call.split('"').nth(1) {
                used.insert(code.to_string());
            }
        }
    }
    assert!(!used.is_empty());
    for code in used {
        assert!(
            documented.contains(&code),
            "error code {code} is missing in openapi_overlay.yaml (errorCodes)"
        );
    }
}
