//! Handwritten signature image on documents. Typst cannot embed PDFs when it exports PDF/A, so a
//! PDF signature is converted to SVG (first page, vector) before it is handed to the template.
//! The SVG is cropped to its visible content so a signature on a full A4 page is not shrunk.

use hayro_svg::{
    hayro_interpret::{InterpreterSettings, RenderContent}, hayro_syntax::Pdf, RenderCache, SvgRenderSettings,
};
use std::sync::Arc;

/// First page of a PDF as SVG text with a transparent background; `None` if it cannot be read.
pub fn pdf_to_svg(bytes: &[u8]) -> Option<String> {
    let data = bytes.to_vec();
    // The PDF is untrusted input: a parser bug must not take the request handler down.
    std::panic::catch_unwind(move || {
        let pdf = Pdf::new(Arc::new(data)).ok()?;
        let page = pdf.pages().first()?;
        let settings = InterpreterSettings {
            render_content: RenderContent::PAGE,
            ..InterpreterSettings::default()
        };
        let svg = hayro_svg::convert(
            page,
            &RenderCache::new(),
            &settings,
            &SvgRenderSettings { bg_color: [0, 0, 0, 0] },
        );
        Some(crop_to_content(&svg).unwrap_or(svg))
    })
    .ok()
    .flatten()
}

/// Pixels per SVG unit when the page is rendered to find its visible content.
const PROBE_SCALE: f32 = 2.0;
const MARGIN: f32 = 2.0;

/// Sets `viewBox`, `width` and `height` of the root element to the bounding box of everything
/// that is drawn (alpha > 0); `None` if the SVG is blank or not in the expected shape.
fn crop_to_content(svg: &str) -> Option<String> {
    let tree = usvg::Tree::from_str(svg, &usvg::Options::default()).ok()?;
    let size = tree.size();
    let (w, h) = ((size.width() * PROBE_SCALE).ceil() as u32, (size.height() * PROBE_SCALE).ceil() as u32);
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 16_000_000 {
        return None;
    }
    let mut pixmap = tiny_skia::Pixmap::new(w, h)?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(PROBE_SCALE, PROBE_SCALE), &mut pixmap.as_mut());

    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
    for (i, px) in pixmap.data().chunks_exact(4).enumerate() {
        if px[3] > 8 {
            let (x, y) = (i as u32 % w, i as u32 / w);
            (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x + 1), y1.max(y + 1));
        }
    }
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let left = (x0 as f32 / PROBE_SCALE - MARGIN).max(0.0);
    let top = (y0 as f32 / PROBE_SCALE - MARGIN).max(0.0);
    let width = (x1 as f32 / PROBE_SCALE + MARGIN).min(size.width()) - left;
    let height = (y1 as f32 / PROBE_SCALE + MARGIN).min(size.height()) - top;

    let end = svg.find('>')?;
    let (root, rest) = svg.split_at(end);
    // hayro writes `viewBox`, `width` and `height` first; keep the namespace declarations after them
    let namespaces = &root[root.find("xmlns")?..];
    Some(format!(
        "<svg viewBox=\"{left} {top} {width} {height}\" width=\"{width}\" height=\"{height}\" {namespaces}{rest}"
    ))
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn crops_a_signature_on_a_full_page() {
        let source = "#set document(date: datetime(year: 2026, month: 1, day: 1))\n#set page(paper: \"a4\")\n#place(top + left, dx: 30mm, dy: 200mm, line(length: 50mm, stroke: 2pt))";
        let pdf = crate::render_pdf(source, serde_json::json!({}), vec![]).await.map_err(|e| e.details).unwrap();
        let svg = super::pdf_to_svg(&pdf).unwrap();
        let view_box = svg.split("viewBox=\"").nth(1).unwrap().split('"').next().unwrap();
        let v: Vec<f32> = view_box.split(' ').map(|n| n.parse().unwrap()).collect();
        // a 50 mm line plus margins, not the 595 x 842 pt page
        assert!((v[2] - (141.7 + 4.0)).abs() < 3.0, "{view_box}");
        assert!(v[3] < 12.0, "{view_box}");
        assert!(svg.starts_with("<svg viewBox=\"") && svg.contains(" xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(!svg.split('>').next().unwrap().contains(" 595"));
    }

    #[tokio::test]
    async fn ignores_pdf_annotations() {
        use lopdf::{dictionary, Object, Stream};

        let pdf = crate::render_pdf("#set document(date: datetime(year: 2026, month: 1, day: 1))\nA signature", serde_json::json!({}), vec![])
            .await.map_err(|e| e.details).unwrap();
        let expected = super::pdf_to_svg(&pdf).unwrap();
        let mut document = lopdf::Document::load_mem(&pdf).unwrap();
        let page_id = *document.get_pages().values().next().unwrap();
        let appearance = document.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
            },
            b"0 0 100 100 re f".to_vec(),
        ));
        let annotation = document.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Stamp",
            "Rect" => vec![0.into(), 0.into(), 100.into(), 100.into()],
            "AP" => dictionary! { "N" => Object::Reference(appearance) },
        });
        document.get_object_mut(page_id).unwrap().as_dict_mut().unwrap()
            .set("Annots", vec![Object::Reference(annotation)]);
        let mut annotated_pdf = Vec::new();
        document.save_to(&mut annotated_pdf).unwrap();

        let parsed = super::Pdf::new(super::Arc::new(annotated_pdf.clone())).unwrap();
        let rendered_with_annotations = hayro_svg::convert(
            parsed.pages().first().unwrap(),
            &super::RenderCache::new(),
            &super::InterpreterSettings::default(),
            &super::SvgRenderSettings { bg_color: [0, 0, 0, 0] },
        );
        assert_ne!(super::crop_to_content(&rendered_with_annotations).unwrap(), expected);
        assert_eq!(super::pdf_to_svg(&annotated_pdf).unwrap(), expected);
    }

    #[test]
    fn rejects_garbage() {
        assert!(super::pdf_to_svg(b"%PDF-1.7 nonsense").is_none());
    }
}
