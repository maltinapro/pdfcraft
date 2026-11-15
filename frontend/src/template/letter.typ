// Letter (Brief, DIN 5008 style): subject, free text and a closing with the sender's name
#set document(title: "{{ doc.subject }}")

#metadata("zone 3 start") <pdfcraft-zone-3-start>
#facts(
  {% if doc.reference %}(t("Ihr Zeichen", "Your reference"), "{{ doc.reference }}"),{% endif %}
  (t("Datum", "Date"), "{{ doc.dateText }}"),
)

#metadata("zone 3 end") <pdfcraft-zone-3-end>
#metadata("zone 4 start") <pdfcraft-zone-4-start>
#text(11pt, weight: "bold", "{{ doc.subject }}")
#v(4mm)
#lines("{{ doc.body }}")
#closing-only
{% if assets and assets.signature %}#v(2mm)
#signature-image
#v(1mm){% else %}#v(14mm){% endif %}
#"{{ settings.sender.name }}"
#metadata("zone 4 end") <pdfcraft-zone-4-end>
