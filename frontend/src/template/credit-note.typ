// Credit note / cancellation invoice (Stornorechnung): refers to the cancelled invoice and shows
// negative amounts (the backend negates the quantities). The attached ZUGFeRD / XRechnung XML is an
// EN 16931 credit note (TypeCode 381, positive amounts) referencing the cancelled invoice.
#set document(title: t("Stornorechnung ", "Credit note ") + number)

#letterhead(
  (t("Storno zu Rechnung", "Cancels invoice"), "{{ doc.reference }}"),
  (t("Rechnungsdatum", "Invoice date"), {% if doc.referenceDateText %}"{{ doc.referenceDateText }}"{% else %}none{% endif %}),
)
#doc-heading(t("Stornorechnung", "Credit note"))

#intro-text
#if "{{ doc.reason }}" != "" [
  #t("Grund der Stornierung", "Reason for cancellation"): #lines("{{ doc.reason }}")
  #v(1em)
]

#metadata("zone 3 end") <pdfcraft-zone-3-end>
#metadata("zone 4 start") <pdfcraft-zone-4-start>
#items-table()
#totals-block(t("Gutschriftsbetrag", "Credit amount"))
#closing-text
#metadata("zone 4 end") <pdfcraft-zone-4-end>
