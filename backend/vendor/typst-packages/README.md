# Vendored Typst packages

Source: https://github.com/typst/packages (`packages/preview/<name>/<version>`), images removed.
Loaded at runtime from here (override with env `TYPST_PACKAGE_PATH`); no network access.

Packages: sepay 0.1.1, ibanator 0.1.0, rustycure 0.2.0 (all used for the EPC QR code).
Keep each package's LICENSE. To update: copy the new version dir plus all transitive `@preview/...` imports.
