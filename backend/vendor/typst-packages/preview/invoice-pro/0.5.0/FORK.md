# Fork notice

This repository is a fork of [leonieziechmann/invoice-pro](https://github.com/leonieziechmann/invoice-pro)
(Typst Universe: https://typst.app/universe/package/invoice-pro/), created by
[maltinapro](https://github.com/maltinapro) for use in [PDFCraft](https://github.com/maltinapro/pdfcraft).

- **Original author / copyright:** Leonie Ziechmann (see `LICENSE`)
- **License:** MIT — the original `LICENSE` file and copyright notice are kept unchanged, as the license requires.
- **Branch `pdfcraft`:** upstream `main` at commit `1e203c7` (unreleased development state after `v0.5.0`, new theming API, XRechnung/contact support) plus this file and the changes below. This is what PDFCraft vendors. Fork tags are named `v<upstream>-pdfcraft.<n>`; current: `v0.5.0-pdfcraft.4`. (`.3` = `.4` without the `item` change, `.2` = upstream `794f21d` + this file, `.1` = upstream release `v0.5.0` + this file.)
- **Changes against upstream:**
  - `src/themes/components/line-items/table.typ`: with `keep-together: true` the table measured every entry as its own table (`fits`), costing one extra table layout per item (~20 % of the compile time of a typical invoice). Entries that are obviously small (item kind, at most 3 modifiers, name and description up to 150 characters, each line break counting as 80) are no longer measured; the measurement is kept for everything else (long texts, groups).
  - `src/components/item.typ`: the `item` scope (run twice per item, measure and draw pass) is written as plain dictionary updates instead of a `loom.mutator.batch` of derive/put/update/ensure steps with identical semantics; the mutator fallback remains for a locale without `normalize`. About 25 % faster for a 23-item invoice (197 -> 147 ms), 8 % for 3 items; the PDF is byte-identical.

Note: the package version in `typst.toml` is still `0.5.0`, as in upstream `main`; the content differs from the released `0.5.0` (e.g. `payment-terms` replaces `payment-goal`, `theme.classic` replaces `themes.DIN-5008`).
