// Order confirmation (Auftragsbestätigung)
#set document(title: t("Auftragsbestätigung ", "Order confirmation ") + "{{ doc.number }}")

#facts(
  {% if doc.reference %}(t("Ihre Bestellung / Angebot", "Your order / offer"), "{{ doc.reference }}"),{% endif %}
  {% if doc.deliveryDateText %}(t("Voraussichtliche Lieferung", "Expected delivery"), "{{ doc.deliveryDateText }}"),{% endif %}
)
#heading-row(t("Auftragsbestätigung", "Order confirmation"))

#intro-text
#items-table()
#totals-block(t("Auftragswert:", "Order value:"))
#closing-text
