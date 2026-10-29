//! Adds the Factur-X / ZUGFeRD XMP extension schema to the exported PDF/A-3b.
//!
//! Typst writes its own XMP metadata and offers no way to extend it, so
//! PDF-level ZUGFeRD validators (e.g. Mustang) report missing `fx:` properties.
//! This post-processing step adds them when a Factur-X/XRechnung XML is attached.

use lopdf::{Dictionary, Document, Object, ObjectId};

const FX_NAMESPACE: &str = "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#";
const XML_NAMES: [&str; 2] = ["factur-x.xml", "xrechnung.xml"];

const SCHEMA: &str = concat!(
    "<rdf:li rdf:parseType=\"Resource\">",
    "<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>",
    "<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>",
    "<pdfaSchema:prefix>fx</pdfaSchema:prefix>",
    "<pdfaSchema:property><rdf:Seq>",
    "<rdf:li rdf:parseType=\"Resource\"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>",
    "<rdf:li rdf:parseType=\"Resource\"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>",
    "<rdf:li rdf:parseType=\"Resource\"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>",
    "<rdf:li rdf:parseType=\"Resource\"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>",
    "</rdf:Seq></pdfaSchema:property></rdf:li>"
);

fn name_of(obj: &Object) -> Option<String> {
    match obj {
        Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).into_owned()),
        _ => None,
    }
}

/// Finds an attached `factur-x.xml` / `xrechnung.xml` and returns its name and content.
fn find_invoice_xml(doc: &Document) -> Option<(String, String)> {
    for object in doc.objects.values() {
        let Object::Dictionary(spec) = object else { continue };
        if spec.get(b"Type").ok().and_then(|t| t.as_name().ok()) != Some(b"Filespec".as_slice()) {
            continue;
        }
        let file_name = spec
            .get(b"UF")
            .ok()
            .and_then(name_of)
            .or_else(|| spec.get(b"F").ok().and_then(name_of))?;
        let file_name = file_name.trim_start_matches('/').to_string();
        if !XML_NAMES.contains(&file_name.to_lowercase().as_str()) {
            continue;
        }
        let ef = spec.get(b"EF").ok()?.as_dict().ok().or_else(|| {
            let id = spec.get(b"EF").ok()?.as_reference().ok()?;
            doc.get_dictionary(id).ok()
        })?;
        let stream_id = ef.get(b"F").ok()?.as_reference().ok()?;
        let stream = doc.get_object(stream_id).ok()?.as_stream().ok()?;
        let content = stream.decompressed_content().unwrap_or_else(|_| stream.content.clone());
        return Some((file_name, String::from_utf8_lossy(&content).into_owned()));
    }
    None
}

/// Maps the CII guideline id (BT-24) to the Factur-X `ConformanceLevel` value.
fn conformance_level(xml: &str) -> &'static str {
    let guideline = xml
        .split("GuidelineSpecifiedDocumentContextParameter")
        .nth(1)
        .and_then(|part| part.split("<ram:ID>").nth(1))
        .and_then(|part| part.split("</ram:ID>").next())
        .unwrap_or("")
        .to_lowercase();
    if guideline.contains("xrechnung") {
        "XRECHNUNG"
    } else if guideline.contains("extended") {
        "EXTENDED"
    } else if guideline.contains("basicwl") {
        "BASIC WL"
    } else if guideline.contains("basic") {
        "BASIC"
    } else if guideline.contains("minimum") {
        "MINIMUM"
    } else {
        "EN 16931"
    }
}

fn metadata_id(doc: &Document) -> Option<ObjectId> {
    let root_id = doc.trailer.get(b"Root").ok()?.as_reference().ok()?;
    let catalog: &Dictionary = doc.get_dictionary(root_id).ok()?;
    catalog.get(b"Metadata").ok()?.as_reference().ok()
}

fn patch_xmp(xmp: &str, file_name: &str, level: &str) -> Option<String> {
    if xmp.contains(FX_NAMESPACE) {
        return None;
    }
    let with_ns = xmp.replacen(
        "<rdf:Description ",
        &format!("<rdf:Description xmlns:fx=\"{FX_NAMESPACE}\" "),
        1,
    );
    let marker = "</rdf:Bag></pdfaExtension:schemas>";
    let with_schema = with_ns.replacen(marker, &format!("{SCHEMA}{marker}"), 1);
    if with_schema == with_ns {
        return None;
    }
    let properties = format!(
        "<fx:DocumentFileName>{file_name}</fx:DocumentFileName><fx:DocumentType>INVOICE</fx:DocumentType><fx:Version>1.0</fx:Version><fx:ConformanceLevel>{level}</fx:ConformanceLevel>"
    );
    let end = "</rdf:Description>";
    let patched = with_schema.replacen(end, &format!("{properties}{end}"), 1);
    (patched != with_schema).then_some(patched)
}

/// Returns the PDF with Factur-X XMP properties, or the input unchanged if nothing applies.
pub fn add_facturx_xmp(pdf: Vec<u8>) -> Vec<u8> {
    match try_add(&pdf) {
        Ok(Some(patched)) => patched,
        Ok(None) => pdf,
        Err(e) => {
            eprintln!("Factur-X XMP post-processing skipped: {e}");
            pdf
        }
    }
}

fn try_add(pdf: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let mut doc = Document::load_mem(pdf).map_err(|e| e.to_string())?;
    let Some((file_name, xml)) = find_invoice_xml(&doc) else {
        return Ok(None);
    };
    let id = metadata_id(&doc).ok_or("no XMP metadata stream")?;
    let level = conformance_level(&xml);

    let stream = doc
        .get_object_mut(id)
        .map_err(|e| e.to_string())?
        .as_stream_mut()
        .map_err(|e| e.to_string())?;
    let content = stream.decompressed_content().unwrap_or_else(|_| stream.content.clone());
    let xmp = String::from_utf8(content).map_err(|e| e.to_string())?;
    let Some(patched) = patch_xmp(&xmp, &file_name, level) else {
        return Ok(None);
    };
    stream.dict.remove(b"Filter");
    stream.dict.remove(b"DecodeParms");
    stream.set_content(patched.into_bytes());

    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| e.to_string())?;
    Ok(Some(out))
}
