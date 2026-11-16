// Offer (Angebot)
#set document(title: t("Angebot ", "Offer ") + number)

#letterhead(
  {% if doc.validUntilText %}(t("Gültig bis", "Valid until"), "{{ doc.validUntilText }}"),{% endif %}
  {% if doc.reference %}(t("Ihre Anfrage", "Your enquiry"), "{{ doc.reference }}"),{% endif %}
)
#doc-heading(t("Angebot", "Offer"))

#intro-text
#metadata("zone 3 end") <pdfcraft-zone-3-end>
#metadata("zone 4 start") <pdfcraft-zone-4-start>
#items-table()
#totals-block(t("Gesamtbetrag", "Total amount"))
#closing-text
#metadata("zone 4 end") <pdfcraft-zone-4-end>
