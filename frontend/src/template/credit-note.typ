// Credit note / cancellation invoice (Stornorechnung): refers to the cancelled invoice and shows
// negative amounts (the backend negates the quantities). No e-invoice XML is attached.
#set document(title: t("Stornorechnung ", "Credit note ") + "{{ doc.number }}")

#facts(
  (t("Storno zu Rechnung", "Cancels invoice"), "{{ doc.reference }}"),
  (t("Rechnungsdatum", "Invoice date"), {% if doc.referenceDateText %}"{{ doc.referenceDateText }}"{% else %}none{% endif %}),
)
#heading-row(t("Stornorechnung", "Credit note"))

#intro-text
#if "{{ doc.reason }}" != "" [
  #t("Grund der Stornierung", "Reason for cancellation"): #lines("{{ doc.reason }}")
  #v(1em)
]

#items-table()
#totals-block(t("Gutschriftsbetrag:", "Credit amount:"))
#closing-text
