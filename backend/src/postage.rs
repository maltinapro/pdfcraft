//! Postage stamp (Internetmarke franking mark) on a document: validation of the PNG that the
//! client sends along with the document. The backend never stores it; the PNG only lives in
//! the request, is embedded as a per-request virtual file and is gone with the response.

use crate::invoice::Errors;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};

const MAX_BYTES: usize = 300 * 1024;
const MAX_PIXELS: u32 = 3000;
/// The franking mark must fit into the 85 x 45 mm address field of DIN 5008 form B.
const MAX_WIDTH_MM: f64 = 85.0;
const MAX_HEIGHT_MM: f64 = 40.0;
/// Resolution requested from Deutsche Post (`DPI300`) when the PNG carries no `pHYs` chunk.
const DEFAULT_DPI: f64 = 300.0;
const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Deserialize, Clone)]
pub struct Postage {
    pub base64: String,
}

/// A validated stamp: its physical size in millimetres.
pub struct Checked {
    pub width_mm: f64,
    pub height_mm: f64,
}

impl Checked {
    /// Template data (`<document>.postage`).
    pub fn data(&self) -> JsonValue {
        json!({ "widthMm": self.width_mm, "heightMm": self.height_mm })
    }
}

/// Width and height in pixels plus the resolution in dpi (from `pHYs`, otherwise 300).
fn inspect(png: &[u8]) -> Option<(u32, u32, f64)> {
    if png.len() < 33 || png[..8] != SIGNATURE || &png[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(png[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(png[20..24].try_into().ok()?);
    let mut dpi = DEFAULT_DPI;
    let mut pos = 8;
    while pos + 12 <= png.len() {
        let len = u32::from_be_bytes(png[pos..pos + 4].try_into().ok()?) as usize;
        let kind = &png[pos + 4..pos + 8];
        if kind == b"IDAT" || kind == b"IEND" {
            break;
        }
        if kind == b"pHYs" && len == 9 && pos + 12 + len <= png.len() {
            let data = &png[pos + 8..pos + 8 + len];
            let per_meter = u32::from_be_bytes(data[..4].try_into().ok()?);
            if data[8] == 1 && per_meter > 0 {
                let candidate = f64::from(per_meter) * 0.0254;
                if (150.0..=600.0).contains(&candidate) {
                    dpi = candidate;
                }
            }
        }
        pos += 12 + len;
    }
    Some((width, height, dpi))
}

/// Physical size in mm, rounded to 0.1 mm.
fn size_mm(pixels: u32, dpi: f64) -> f64 {
    (f64::from(pixels) / dpi * 25.4 * 10.0).round() / 10.0
}

/// Physical size (width, height) in mm of a PNG, e.g. a freshly bought stamp.
pub fn dimensions_mm(png: &[u8]) -> Option<(f64, f64)> {
    let (w, h, dpi) = inspect(png)?;
    Some((size_mm(w, dpi), size_mm(h, dpi)))
}

pub fn check(postage: &Postage, path: &str, e: &mut Errors) -> Option<Checked> {
    let path = format!("{path}.postage");
    let png = match BASE64.decode(postage.base64.trim()) {
        Ok(bytes) if bytes.len() <= MAX_BYTES => bytes,
        Ok(_) => {
            e.add(&path, &format!("must not be larger than {} KB", MAX_BYTES / 1024));
            return None;
        }
        Err(_) => {
            e.add(&path, "must be a base64 encoded PNG");
            return None;
        }
    };
    let Some((w, h, dpi)) = inspect(&png).filter(|(w, h, _)| (1..=MAX_PIXELS).contains(w) && (1..=MAX_PIXELS).contains(h)) else {
        e.add(&path, "must be a valid PNG image");
        return None;
    };
    let (width_mm, height_mm) = (size_mm(w, dpi), size_mm(h, dpi));
    if width_mm > MAX_WIDTH_MM || height_mm > MAX_HEIGHT_MM {
        e.add(&path, &format!("is {width_mm} x {height_mm} mm; the franking mark must fit into the address field"));
        return None;
    }
    Some(Checked { width_mm, height_mm })
}

/// Validates the optional stamp of a document and returns it with its template data.
pub fn check_optional(postage: Option<&Postage>, path: &str, e: &mut Errors) -> Option<Checked> {
    postage.and_then(|p| check(p, path, e))
}

/// Adds the stamp PNG to the virtual files of a render request (`assets.postage`).
pub fn attach(postage: Option<&Postage>, assets: &mut Vec<(String, Vec<u8>)>) {
    if let Some(p) = postage {
        if let Ok(png) = BASE64.decode(p.base64.trim()) {
            assets.push(("postage".to_string(), png));
        }
    }
}

/// A valid grayscale PNG (stored deflate, with CRCs) that looks vaguely like a franking mark.
#[cfg(test)]
pub(crate) fn test_png(width: u32, height: u32, dpi: Option<u32>) -> Vec<u8> {
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = !0u32;
        for byte in data {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend((data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend(data);
        out.extend(&body);
        out.extend(crc32(&body).to_be_bytes());
    }
    let mut raw = Vec::new();
    for y in 0..height {
        raw.push(0);
        for x in 0..width {
            let border = x < 4 || y < 4 || x + 4 >= width || y + 4 >= height;
            let code = x > width / 2 && (x / 8 + y / 8) % 2 == 0;
            raw.push(if border || code { 0 } else { 235 });
        }
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65535).collect();
    for (i, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(i + 1 == blocks.len()));
        zlib.extend((block.len() as u16).to_le_bytes());
        zlib.extend((!(block.len() as u16)).to_le_bytes());
        zlib.extend(*block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for byte in &raw {
        a = (a + u32::from(*byte)) % 65521;
        b = (b + a) % 65521;
    }
    zlib.extend(((b << 16) | a).to_be_bytes());

    let mut png = SIGNATURE.to_vec();
    let mut ihdr = Vec::new();
    ihdr.extend(width.to_be_bytes());
    ihdr.extend(height.to_be_bytes());
    ihdr.extend([8, 0, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &ihdr);
    if let Some(dpi) = dpi {
        let per_meter = (f64::from(dpi) / 0.0254).round() as u32;
        let mut phys = Vec::new();
        phys.extend(per_meter.to_be_bytes());
        phys.extend(per_meter.to_be_bytes());
        phys.push(1);
        chunk(&mut png, b"pHYs", &phys);
    }
    chunk(&mut png, b"IDAT", &zlib);
    chunk(&mut png, b"IEND", &[]);
    png
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(png: &[u8]) -> Postage {
        Postage { base64: BASE64.encode(png) }
    }

    #[test]
    fn measures_the_stamp_at_300_dpi_by_default() {
        let mut e = Errors::default();
        let checked = check(&encoded(&test_png(472, 283, None)), "invoice", &mut e).unwrap();
        assert!(e.0.is_empty());
        assert_eq!((checked.width_mm, checked.height_mm), (40.0, 24.0));
    }

    #[test]
    fn uses_the_resolution_stored_in_the_png() {
        let mut e = Errors::default();
        let checked = check(&encoded(&test_png(203, 120, Some(203))), "invoice", &mut e).unwrap();
        assert_eq!((checked.width_mm, checked.height_mm), (25.4, 15.0));
    }

    #[test]
    fn rejects_everything_that_is_not_a_reasonably_sized_png() {
        for (value, what) in [
            (Postage { base64: "not base64!".into() }, "base64"),
            (encoded(b"GIF89a....................................."), "PNG"),
            (encoded(&test_png(2000, 100, None)), "address field"),
            (encoded(&test_png(0, 100, None)), "PNG"),
            (encoded(&vec![0u8; MAX_BYTES + 1]), "larger"),
        ] {
            let mut e = Errors::default();
            assert!(check(&value, "document", &mut e).is_none());
            assert!(e.0.iter().any(|m| m.contains(what) && m.starts_with("document.postage")), "{what}: {:?}", e.0);
        }
    }
}
