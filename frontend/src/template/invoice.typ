// Static invoice template: lays out the invoice on top of the shared layout (`layout.typ`, prepended
// by the backend). Amounts, display texts and the e-invoice XML are computed in
// `backend/src/einvoice.rs`. No Typst packages except `sepay` (EPC QR code, imported in the layout).
#set document(title: t("Rechnung ", "Invoice ") + number)

#letterhead(
  {% if settings.sender.taxNr %}(t("Steuernummer", "Tax ID"), "{{ settings.sender.taxNr }}"),{% endif %}
  {% if settings.sender.vatId %}(t("USt-IdNr.", "VAT ID"), "{{ settings.sender.vatId }}"),{% endif %}
  (t("Leistungszeitraum", "Period of service"), "{{ invoice.serviceDateText }}"),
  {% if invoice.recipient.buyerReference %}(t("Käuferreferenz", "Buyer reference"), "{{ invoice.recipient.buyerReference }}"),{% endif %}
  date-label: t("Rechnungsdatum", "Invoice date"),
)
#doc-heading(t("Rechnung", "Invoice"), place: "{{ pay.place }}")

#intro-text
#metadata("zone 3 end") <pdfcraft-zone-3-end>
#metadata("zone 4 start") <pdfcraft-zone-4-start>
#items-table()
#totals-block(t("Gesamtbetrag", "Total amount"), due-label: t("Zu zahlen", "Amount due"))
#v(0.5em)
#payment-block
#closing-text
#metadata("zone 4 end") <pdfcraft-zone-4-end>
