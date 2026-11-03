// Delivery note (Lieferschein): quantities only, no prices; signature line for the recipient
#set document(title: t("Lieferschein ", "Delivery note ") + "{{ doc.number }}")

#facts(
  {% if doc.reference %}(t("Ihre Bestellung", "Your order"), "{{ doc.reference }}"),{% endif %}
  (t("Lieferdatum", "Delivery date"), {% if doc.deliveryDateText %}"{{ doc.deliveryDateText }}"{% else %}"{{ doc.dateText }}"{% endif %}),
)
#heading-row(t("Lieferschein", "Delivery note"))

#intro-text
#items-table(prices: false)
#closing-text

#v(1fr)
#block(breakable: false, grid(
  columns: (1fr, 1fr),
  column-gutter: 20mm,
  [#line(length: 100%, stroke: 0.5pt) #small(t("Ort, Datum", "Place, date"))],
  [#line(length: 100%, stroke: 0.5pt) #small(t("Unterschrift Empfänger", "Recipient's signature"))],
))
