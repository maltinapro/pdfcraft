// Offer (Angebot)
#set document(title: t("Angebot ", "Offer ") + "{{ doc.number }}")

#facts(
  {% if doc.validUntilText %}(t("Gültig bis", "Valid until"), "{{ doc.validUntilText }}"),{% endif %}
  {% if doc.reference %}(t("Ihre Anfrage", "Your enquiry"), "{{ doc.reference }}"),{% endif %}
)
#heading-row(t("Angebot", "Offer"))

#intro-text
#items-table()
#totals-block(t("Gesamtbetrag:", "Total amount:"))
#closing-text
