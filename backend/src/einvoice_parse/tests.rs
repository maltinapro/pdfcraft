use super::*;
use serde_json::{json, Value};
use std::path::PathBuf;

/// Test files and golden results of the browser viewer (`frontend/src/lib/einvoice/testdata/`).
fn testdata() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/src/lib/einvoice/testdata")
}

fn read(name: &str) -> Vec<u8> {
    std::fs::read(testdata().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// Numbers compare as `f64` (`760` in the golden file, `760.0` from Rust).
fn normalized(value: Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(list) => Value::Array(list.into_iter().map(normalized).collect()),
        Value::Object(map) => {
            Value::Object(map.into_iter().map(|(k, v)| (k, normalized(v))).collect())
        }
        other => other,
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Value {
    normalized(serde_json::to_value(value).unwrap())
}

fn parse(name: &str, lang: Lang) -> ParseResponse {
    parse_upload(&read(name), name, lang)
        .unwrap_or_else(|e| panic!("{name}: {} {}", e.code, e.details))
}

fn fail(bytes: &[u8]) -> ParseFailure {
    parse_upload(bytes, "upload.bin", Lang::En).expect_err("the upload is rejected")
}

fn xml_names() -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(testdata())
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(".xml"))
        .collect();
    names.sort();
    names
}

#[test]
fn matches_the_golden_files_of_the_frontend_viewer() {
    let names = xml_names();
    assert!(names.len() >= 10, "{names:?}");
    for name in names {
        let golden: Value = serde_json::from_slice(&read(&format!(
            "expected/{}.json",
            name.trim_end_matches(".xml")
        )))
        .unwrap();
        let golden = normalized(golden);
        for (code, lang) in [("de", Lang::De), ("en", Lang::En)] {
            let response = parse(&name, lang);
            assert_eq!(response.source, Source::Xml);
            assert_eq!(response.file_name, name);
            assert_eq!(to_json(&response.invoice), golden["view"], "{name}: view");
            assert_eq!(
                to_json(&response.checks),
                golden[code]["checks"],
                "{name} ({code}): checks"
            );
            assert_eq!(
                to_json(&response.not_checked),
                golden[code]["notChecked"],
                "{name} ({code}): notChecked"
            );
        }
    }
}

#[test]
fn reads_the_xml_of_the_corpus_pdf_like_the_viewer() {
    let response = parse("xrechnung-mixed-rates.pdf", Lang::De);
    assert_eq!(response.source, Source::Pdf);
    assert_eq!(response.file_name, "xrechnung.xml");
    let from_xml = parse("xrechnung-mixed-rates.xml", Lang::De);
    assert_eq!(to_json(&response.invoice), to_json(&from_xml.invoice));
    assert_eq!(to_json(&response.checks), to_json(&from_xml.checks));
}

#[test]
fn a_generated_invoice_has_no_findings() {
    for name in [
        "xrechnung-mixed-rates.pdf",
        "xrechnung-exempt.xml",
        "credit-note-en16931.xml",
    ] {
        let response = parse(name, Lang::En);
        let findings: Vec<_> = response
            .checks
            .iter()
            .filter(|c| c.status != check::Status::Ok)
            .collect();
        assert!(findings.is_empty(), "{name}: {findings:?}");
    }
}

#[test]
fn finds_problems_and_names_them_in_the_requested_language() {
    let en = parse("plausibility-findings.xml", Lang::En);
    let de = parse("plausibility-findings.xml", Lang::De);
    let status = |r: &ParseResponse, id: &str| r.checks.iter().find(|c| c.id == id).unwrap().status;
    assert_eq!(status(&en, "line-math"), check::Status::Error);
    assert_eq!(status(&en, "payment"), check::Status::Warning);
    let finding = |r: &ParseResponse, id: &str| {
        r.checks.iter().find(|c| c.id == id).unwrap().findings[0].clone()
    };
    assert!(
        finding(&en, "line-sum").contains("1,235,412.59 EUR"),
        "{}",
        finding(&en, "line-sum")
    );
    assert!(
        finding(&de, "line-sum").contains("1.235.412,59 EUR"),
        "{}",
        finding(&de, "line-sum")
    );
    assert!(en.checks.iter().all(|c| !c.title.is_empty()));
    assert_ne!(en.not_checked, de.not_checked);
    let skipped = parse("plausibility-skipped.xml", Lang::En);
    assert!(skipped
        .checks
        .iter()
        .any(|c| c.status == check::Status::Skipped));
}

#[test]
fn no_check_calls_a_file_valid() {
    let pattern = |text: &str| {
        let lower = text.to_lowercase();
        lower
            .split(|c: char| !c.is_alphabetic())
            .any(|w| matches!(w, "valid" | "valide" | "validierung" | "gültig"))
    };
    for name in xml_names() {
        for lang in [Lang::De, Lang::En] {
            for result in parse(&name, lang).checks {
                assert!(
                    !pattern(&format!("{} {}", result.title, result.findings.join(" "))),
                    "{name}"
                );
            }
        }
    }
}

#[test]
fn rejects_what_is_not_an_e_invoice_with_stable_codes() {
    let code = |bytes: &[u8]| {
        let failure = fail(bytes);
        (failure.status.as_u16(), failure.code)
    };
    assert_eq!(code(b""), (400, "invalid_request"));
    assert_eq!(code(b"hello"), (400, "unsupported_file"));
    assert_eq!(code(b"\x89PNG\r\n"), (400, "unsupported_file"));
    assert_eq!(code(b"<a>"), (400, "invalid_xml"));
    assert_eq!(code(b"<html/>"), (400, "unsupported_einvoice"));
    assert_eq!(
        code(b"<CrossIndustryDocument/>"),
        (400, "unsupported_einvoice")
    );
    assert!(fail(b"<CrossIndustryDocument/>").details.contains("1.x"));
    assert_eq!(
        code(b"%PDF-1.7\nthis is not a pdf"),
        (400, "pdf_unreadable")
    );
}

#[test]
fn enforces_the_size_limits() {
    let mut xml = b"<Invoice>".to_vec();
    xml.resize(extract::MAX_XML_BYTES + 1, b' ');
    let failure = fail(&xml);
    assert_eq!(
        (failure.status.as_u16(), failure.code),
        (413, "invalid_request")
    );
    // exactly the limit is still read (and then rejected as an unsupported document, not as too large)
    xml.truncate(extract::MAX_XML_BYTES);
    assert_eq!(fail(&xml).code, "invalid_xml");

    let mut pdf = b"%PDF-1.7\n".to_vec();
    pdf.resize(MAX_PDF_BYTES + 1, b' ');
    let failure = fail(&pdf);
    assert_eq!(
        (failure.status.as_u16(), failure.code),
        (413, "invalid_request")
    );
}

#[test]
fn a_pdf_without_an_xml_attachment_says_so() {
    // The corpus PDF without its attachments: take the layout of a plain PDF by dropping the file specification
    let mut doc = lopdf::Document::load_mem(&read("xrechnung-mixed-rates.pdf")).unwrap();
    let specs: Vec<_> = doc
        .objects
        .iter()
        .filter(|(_, o)| matches!(o, lopdf::Object::Dictionary(d) if d.has(b"EF")))
        .map(|(id, _)| *id)
        .collect();
    assert!(!specs.is_empty());
    for id in specs {
        doc.objects.remove(&id);
    }
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    let failure = fail(&bytes);
    assert_eq!(
        (failure.status.as_u16(), failure.code),
        (400, "no_xml_attachment")
    );
}

#[test]
fn picks_known_names_first_and_decodes_other_encodings() {
    let list = vec![
        ("other.xml".to_string(), 1),
        ("XRechnung.XML".to_string(), 2),
        ("factur-x.xml".to_string(), 3),
    ];
    assert_eq!(extract::pick(&list).unwrap().1, 3);
    assert_eq!(extract::pick(&list[..2]).unwrap().1, 2);
    assert_eq!(extract::pick(&[("notes.txt".to_string(), 0)]), None);
    assert_eq!(extract::pick(&[("any.xml".to_string(), 7)]).unwrap().1, 7);

    let latin1 =
        b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><Invoice><ID>M\xfcller</ID></Invoice>";
    let view = parse_upload(latin1, "rechnung.xml", Lang::En)
        .unwrap()
        .invoice;
    assert_eq!(view.number.as_deref(), Some("Müller"));
    let bom = b"\xEF\xBB\xBF<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<Invoice><ID>\xc3\x84</ID></Invoice>";
    assert_eq!(
        parse_upload(bom, "a.xml", Lang::En)
            .unwrap()
            .invoice
            .number
            .as_deref(),
        Some("Ä")
    );
}

#[test]
fn language_codes() {
    assert_eq!(Lang::from_code("DE"), Some(Lang::De));
    assert_eq!(Lang::from_code("en"), Some(Lang::En));
    assert_eq!(Lang::from_code("fr"), None);
}

mod xml_reader {
    use super::super::xml::{find, parse_xml, text};

    #[test]
    fn reads_elements_attributes_entities_cdata_and_ignores_prefixes_and_comments() {
        let root = parse_xml("<?xml version=\"1.0\"?><!-- c --><a:Root xmlns:a=\"x\" k='v'><a:Child id=\"1\">A &amp; B &#65;&#x42;</a:Child><Empty/><![CDATA[<raw>]]></a:Root>").unwrap();
        assert_eq!(root.name, "Root");
        assert_eq!(root.attr("k"), Some("v"));
        assert_eq!(
            root.children
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            ["Child", "Empty"]
        );
        assert_eq!(root.children[0].text, "A & B AB");
        assert_eq!(root.children[0].attr("id"), Some("1"));
        assert_eq!(root.text, "<raw>");
        assert_eq!(text(Some(&root), "Child"), Some("A & B AB".to_string()));
        assert!(find(Some(&root), "Child/Nothing").is_none());
    }

    #[test]
    fn does_not_expand_custom_entities() {
        let root = parse_xml("<!DOCTYPE a [<!ENTITY x \"boom\">]><a>&x;</a>").unwrap();
        assert_eq!(root.text, "&x;");
        let bomb = format!(
            "<!DOCTYPE a [<!ENTITY a \"{}\">]><a>&a;&a;</a>",
            "x".repeat(1000)
        );
        assert_eq!(parse_xml(&bomb).unwrap().text, "&a;&a;");
    }

    #[test]
    fn rejects_malformed_xml() {
        for bad in ["<a><b></a>", "<a>", "", "<a/><b/>", "text", "<a b=1/>"] {
            assert!(parse_xml(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn survives_hostile_input() {
        // deep nesting is rejected instead of overflowing the stack
        let deep = "<a>".repeat(100_000);
        assert!(parse_xml(&deep).is_err());
        // many ampersands do not take quadratic time
        let started = std::time::Instant::now();
        let amps = format!("<a>{}</a>", "&".repeat(1_000_000));
        let _ = parse_xml(&amps);
        assert!(started.elapsed().as_secs() < 5);
    }
}

/// The response example of the OpenAPI description is what the endpoint really answers.
#[test]
fn the_openapi_response_example_is_the_real_response() {
    let overlay: Value = serde_norway::from_str(include_str!("../openapi_overlay.yaml")).unwrap();
    let example = overlay["responseExamples"]["parseEInvoice"]["xml"]["value"].clone();
    let response = parse("en16931-exempt.xml", Lang::En);
    let mut actual = to_json(&response);
    actual["fileName"] = json!("invoice.xml");
    assert_eq!(normalized(example), actual);
}
