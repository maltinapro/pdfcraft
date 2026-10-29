# Vendored Typst packages

Source: https://github.com/typst/packages (`packages/preview/<name>/<version>`), images removed.
Loaded at runtime from here (override with env `TYPST_PACKAGE_PATH`); no network access.

Packages: invoice-pro 0.5.0 (MIT; our fork, see below), ibanator 0.1.0, letter-pro 3.0.0, loom 0.1.1, sepay 0.1.1, rustycure 0.2.0.
Keep each package's LICENSE. To update: copy the new version dir plus all transitive `@preview/...` imports.

## invoice-pro fork

`preview/invoice-pro/0.5.0` is vendored from our fork https://github.com/maltinapro/invoice-pro
(branch `pdfcraft`, tag `v0.5.0-pdfcraft.1`), which is a fork of https://github.com/leonieziechmann/invoice-pro
(MIT, © Leonie Ziechmann). `LICENSE` and the copyright notice are kept unchanged; `FORK.md` documents the source and all
changes. Currently the contents are identical to upstream `v0.5.0` (plus `FORK.md`). To change the template, commit to the fork,
tag a new `v0.5.0-pdfcraft.<n>`, and re-copy `src/`, `template/`, `typst.toml`, `LICENSE`, `README.md`, `FORK.md` here.
