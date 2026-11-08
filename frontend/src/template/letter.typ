// Letter (Brief, DIN 5008 style): subject, free text and a closing with the sender's name
#set document(title: "{{ doc.subject }}")

#facts(
  {% if doc.reference %}(t("Ihr Zeichen", "Your reference"), "{{ doc.reference }}"),{% endif %}
  (t("Datum", "Date"), "{{ doc.dateText }}"),
)

#text(11pt, weight: "bold", "{{ doc.subject }}")
#v(4mm)
#lines("{{ doc.body }}")
#closing-only
{% if assets and assets.signature %}#v(2mm)
#signature-image
#v(1mm){% else %}#v(14mm){% endif %}
#"{{ settings.sender.name }}"
