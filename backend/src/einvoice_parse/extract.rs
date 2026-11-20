//! Reads the e-invoice XML from an uploaded file: a PDF (ZUGFeRD / Factur-X / XRechnung attachment) or a plain
//! XML file. A port of `frontend/src/lib/einvoice/extract.ts`, with the same limits and error codes; the PDF is
//! read with `lopdf` instead of pdf.js. Everything stays in memory.

use lopdf::{Dictionary, Document, LoadOptions, Object};

/// Largest PDF and XML file that is read (the same limits as the viewer).
pub const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_XML_BYTES: usize = 5 * 1024 * 1024;
/// Largest size a single object stream of the PDF may inflate to (guards against decompression bombs).
const MAX_PDF_STREAM_BYTES: usize = 64 * 1024 * 1024;

/// Attachment names used by ZUGFeRD, Factur-X and XRechnung PDFs (compared case-insensitively).
const ATTACHMENT_NAMES: [&str; 3] = ["factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml"];

/// Why no XML could be read; `code` is stable and part of the API.
#[derive(Debug, PartialEq, Eq)]
pub struct ExtractError {
    pub code: &'static str,
    pub message: String,
}

fn fail(code: &'static str, message: impl Into<String>) -> ExtractError {
    ExtractError {
        code,
        message: message.into(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Pdf,
    Xml,
}

#[derive(Debug)]
pub struct Extracted {
    pub xml: String,
    pub source: Source,
    /// Name of the attachment the XML was read from (PDF) or of the uploaded file (XML).
    pub file_name: String,
}

fn is_pdf(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(1024)]
        .windows(4)
        .any(|w| w == b"%PDF")
}

fn is_xml(bytes: &[u8]) -> bool {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    bytes
        .iter()
        .find(|b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
        == Some(&b'<')
}

/// The XML declaration may name another encoding (rare for e-invoices); UTF-8 is the default.
fn decode_xml(bytes: &[u8]) -> String {
    let head: String = bytes[..bytes.len().min(200)]
        .iter()
        .map(|&b| b as char)
        .collect();
    let declared = head.find("<?xml").and_then(|start| {
        let rest = &head[start..];
        let rest = &rest[..rest.find("?>").unwrap_or(rest.len())];
        let after = rest[rest.to_ascii_lowercase().find("encoding")? + "encoding".len()..]
            .trim_start()
            .strip_prefix('=')?
            .trim_start();
        let quote = after.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let value = &after[1..];
        Some(value[..value.find(quote)?].to_string())
    });
    if let Some(label) = declared {
        let utf8 = label
            .to_ascii_lowercase()
            .trim_start_matches("utf")
            .trim_start_matches('-')
            == "8";
        if !utf8 {
            if let Some(encoding) = encoding_rs::Encoding::for_label(label.as_bytes()) {
                return encoding.decode(bytes).0.into_owned();
            }
        }
    }
    String::from_utf8_lossy(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes)).into_owned()
}

/// A PDF text string: UTF-16BE with a byte order mark, otherwise (PDFDocEncoding) read as Latin-1/UTF-8.
fn pdf_string(object: &Object) -> Option<String> {
    let Object::String(bytes, _) = object else {
        return None;
    };
    if let Some(utf16) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let units: Vec<u16> = utf16
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_be_bytes(*c))
            .collect();
        return Some(String::from_utf16_lossy(&units));
    }
    Some(String::from_utf8_lossy(bytes).into_owned())
}

/// Picks the e-invoice XML among the attachments of a PDF: known names first, then any other `.xml`.
pub(super) fn pick<T>(list: &[(String, T)]) -> Option<&(String, T)> {
    for known in ATTACHMENT_NAMES {
        if let Some(hit) = list.iter().find(|(name, _)| name.to_lowercase() == known) {
            return Some(hit);
        }
    }
    list.iter()
        .find(|(name, _)| name.to_lowercase().ends_with(".xml"))
}

fn embedded_file<'a>(doc: &'a Document, spec: &'a Dictionary) -> Option<&'a lopdf::Stream> {
    let ef = spec.get(b"EF").ok()?;
    let ef = match ef {
        Object::Reference(id) => doc.get_dictionary(*id).ok()?,
        other => other.as_dict().ok()?,
    };
    let id = ef.get(b"F").ok()?.as_reference().ok()?;
    doc.get_object(id).ok()?.as_stream().ok()
}

fn read_pdf(bytes: &[u8]) -> Result<(String, Vec<u8>), ExtractError> {
    let options = LoadOptions {
        max_decompressed_size: Some(MAX_PDF_STREAM_BYTES),
        ..Default::default()
    };
    let doc = Document::load_mem_with_options(bytes, options).map_err(|e| match e {
        lopdf::Error::InvalidPassword | lopdf::Error::Decryption(_) => {
            fail("pdf_encrypted", "The PDF is password protected")
        }
        other => fail("pdf_unreadable", other.to_string()),
    })?;
    if doc.is_encrypted() {
        return Err(fail("pdf_encrypted", "The PDF is password protected"));
    }
    // Every dictionary with an `EF` entry is a file specification (some writers omit `/Type /Filespec`)
    let mut files = Vec::new();
    for object in doc.objects.values() {
        let Object::Dictionary(spec) = object else {
            continue;
        };
        if !spec.has(b"EF") {
            continue;
        }
        let name = spec
            .get(b"UF")
            .ok()
            .and_then(pdf_string)
            .or_else(|| spec.get(b"F").ok().and_then(pdf_string));
        let (Some(name), Some(stream)) = (name, embedded_file(&doc, spec)) else {
            continue;
        };
        files.push((name.trim_start_matches('/').to_string(), stream));
    }
    let Some((name, stream)) = pick(&files) else {
        return Err(fail("no_xml", "The PDF has no XML attachment"));
    };
    let content = stream
        .decompressed_content_with_limit(MAX_XML_BYTES + 1)
        .map_err(|e| match e {
            lopdf::Error::Decompress(lopdf::DecompressError::MemoryLimitExceeded { .. }) => {
                fail("too_large", "The XML attachment is too large")
            }
            other => fail("pdf_unreadable", other.to_string()),
        })?;
    if content.len() > MAX_XML_BYTES {
        return Err(fail("too_large", "The XML attachment is too large"));
    }
    Ok((name.clone(), content))
}

/// Reads the e-invoice XML of an uploaded file (a PDF with an XML attachment, or an XML file).
pub fn extract(bytes: &[u8], file_name: &str) -> Result<Extracted, ExtractError> {
    if bytes.is_empty() {
        return Err(fail("empty", "The file is empty"));
    }
    if is_pdf(bytes) {
        if bytes.len() > MAX_PDF_BYTES {
            return Err(fail("too_large", "The PDF is too large"));
        }
        let (name, content) = read_pdf(bytes)?;
        return Ok(Extracted {
            xml: decode_xml(&content),
            source: Source::Pdf,
            file_name: name,
        });
    }
    if is_xml(bytes) {
        if bytes.len() > MAX_XML_BYTES {
            return Err(fail("too_large", "The XML file is too large"));
        }
        return Ok(Extracted {
            xml: decode_xml(bytes),
            source: Source::Xml,
            file_name: file_name.to_string(),
        });
    }
    Err(fail("unsupported", "Neither a PDF nor an XML file"))
}
