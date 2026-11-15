// Order confirmation (Auftragsbestätigung)
#set document(title: t("Auftragsbestätigung ", "Order confirmation ") + "{{ doc.number }}")

#metadata("zone 3 start") <pdfcraft-zone-3-start>
#facts(
  {% if doc.reference %}(t("Ihre Bestellung / Angebot", "Your order / offer"), "{{ doc.reference }}"),{% endif %}
  {% if doc.deliveryDateText %}(t("Voraussichtliche Lieferung", "Expected delivery"), "{{ doc.deliveryDateText }}"),{% endif %}
)
#heading-row(t("Auftragsbestätigung", "Order confirmation"))

#intro-text
#metadata("zone 3 end") <pdfcraft-zone-3-end>
#metadata("zone 4 start") <pdfcraft-zone-4-start>
#items-table()
#totals-block(t("Auftragswert:", "Order value:"))
#closing-text
#metadata("zone 4 end") <pdfcraft-zone-4-end>
