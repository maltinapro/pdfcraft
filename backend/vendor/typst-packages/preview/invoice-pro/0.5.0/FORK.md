# Fork notice

This repository is a fork of [leonieziechmann/invoice-pro](https://github.com/leonieziechmann/invoice-pro)
(Typst Universe: https://typst.app/universe/package/invoice-pro/), created by
[maltinapro](https://github.com/maltinapro) for use in [PDFCraft](https://github.com/maltinapro/pdfcraft).

- **Original author / copyright:** Leonie Ziechmann (see `LICENSE`)
- **License:** MIT — the original `LICENSE` file and copyright notice are kept unchanged, as the license requires.
- **Branch `pdfcraft`:** upstream `main` at commit `794f21d` (unreleased development state after `v0.5.0`, new theming API, XRechnung/contact support) plus this file. This is what PDFCraft vendors. Fork tags are named `v<upstream>-pdfcraft.<n>`; current: `v0.5.0-pdfcraft.2`. (`v0.5.0-pdfcraft.1` is the older state: upstream release `v0.5.0` plus this file.)
- **Changes against upstream:** none in the package code (this file only). Every future change is listed here.

Note: the package version in `typst.toml` is still `0.5.0`, as in upstream `main`; the content differs from the released `0.5.0` (e.g. `payment-terms` replaces `payment-goal`, `theme.classic` replaces `themes.DIN-5008`).
