// Shared preamble of all non-invoice documents (credit note, offer, order, delivery note,
// letter). The backend (`backend/src/documents.rs`) prepends this file to the type's own
// template and renders both with minijinja. All user text is passed as Typst string literals
// (only `\` and `"` are escaped by the backend); amounts and dates are formatted there.
#let accent = rgb("{{ settings.accentColor }}")
#let en = "{{ settings.locale }}" == "en-de"
#let t(de, en-text) = if en { en-text } else { de }
#let lines(text) = text.split("\n").join(linebreak())
#let muted = luma(110)
#let small(body) = text(8pt, fill: muted, body)
#let doc-title(body) = text(15pt, weight: "bold", body)

#set text(10pt, font: ("{{ settings.font }}", "Libertinus Serif"), lang: if en { "en" } else { "de" })
#set par(leading: 0.6em, spacing: 0.9em)
#set page(
  paper: "a4",
  margin: (left: 25mm, right: 20mm, top: 15mm, bottom: 20mm),
  {% if settings.footer %}footer: align(center, text(8pt, fill: luma(90), lines("{{ settings.footer }}"))),{% endif %}
  background: [
    // DIN 5008 fold marks (105 / 210 mm) and punch mark (148.5 mm)
    #place(top + left, dy: 105mm, dx: 5mm, line(length: 4mm, stroke: 0.4pt + luma(120)))
    #place(top + left, dy: 210mm, dx: 5mm, line(length: 4mm, stroke: 0.4pt + luma(120)))
    #place(top + left, dy: 148.5mm, dx: 5mm, line(length: 8mm, stroke: 0.4pt + luma(120)))
    {% if settings.watermark %}#align(center + horizon, rotate(-35deg, text(100pt, weight: "bold", fill: luma(85%), "{{ settings.watermark }}"))){% endif %}
  ],
)
#set document(
  author: "{{ settings.sender.name }}",
  date: datetime(year: {{ doc.year }}, month: {{ doc.month }}, day: {{ doc.day }}),
)

// Header: logo and sender (DIN 5008, window envelope: address starts at 45 mm)
#block(height: 30mm, width: 100%, grid(
  columns: (1fr, 1fr),
  {% if assets and assets.logo %}image("{{ assets.logo }}", height: 24mm, fit: "contain", alt: "Logo"){% else %}[]{% endif %},
  align(right, [
    *#"{{ settings.sender.name }}"* \
    #"{{ settings.sender.address }}" \
    #"{{ settings.sender.city }}"
    {% if settings.sender.email %}\ #"{{ settings.sender.email }}"{% endif %}
    {% if settings.sender.phone %}\ Tel: #"{{ settings.sender.phone }}"{% endif %}
  ]),
))

#block(height: {% if doc.postage %}calc.max(47.4mm, {{ doc.postage.heightMm }}mm + 20mm){% else %}47.4mm{% endif %}, width: 100%, [
  {% if doc.postage %}// Franking mark (Internetmarke) in the top right of the 85 mm address field; the recipient starts below it
  #place(top + left, dx: 85mm - {{ doc.postage.widthMm }}mm, image("{{ assets.postage }}", width: {{ doc.postage.widthMm }}mm, alt: "Frankiervermerk"))
  #box(width: 83mm - {{ doc.postage.widthMm }}mm, text(7pt, underline[#"{{ settings.sender.name }}", #"{{ settings.sender.address }}", #"{{ settings.sender.city }}"])) \
  #v(1mm + calc.max(0mm, {{ doc.postage.heightMm }}mm - 3.5mm))
  {% else %}#text(7pt, underline[#"{{ settings.sender.name }}", #"{{ settings.sender.address }}", #"{{ settings.sender.city }}"]) \
  #v(1mm)
  {% endif %}  #"{{ doc.recipient.name }}" \
  #"{{ doc.recipient.address }}" \
  #"{{ doc.recipient.city }}"
])

// Small label/value pairs below the address; entries with `none` are skipped
#let facts(..entries) = {
  let shown = entries.pos().filter(e => e.at(1) != none and e.at(1) != "")
  if shown.len() > 0 {
    grid(
      columns: (1fr,) * 3,
      row-gutter: 3mm,
      ..shown.map(e => [#small(e.at(0)) \ #e.at(1)]),
    )
    v(6mm)
  }
}

// Title on the left, place and date on the right
#let heading-row(label, with-number: true) = {
  grid(
    columns: (1fr, auto),
    doc-title[#label#if with-number and "{{ doc.number }}" != "" [ #"{{ doc.number }}"]],
    align(bottom)[#"{{ doc.dateText }}"],
  )
  v(4mm)
}

#let intro-text = [{% if doc.intro %}#lines("{{ doc.intro }}")
#v(1em){% endif %}]
#let closing-only = [{% if doc.closing %}#v(1em)
#lines("{{ doc.closing }}"){% endif %}]

// Handwritten signature (image, SVG or PDF): at most 15 mm high and 60 mm wide
#let signature-image = [{% if assets and assets.signature %}#context {
  let img(..size) = image("{{ assets.signature }}", ..size, alt: t("Unterschrift", "Signature"))
  let natural = measure(img())
  if natural.width * (15mm / natural.height) > 60mm { img(width: 60mm) } else { img(height: 15mm) }
}{% endif %}]
#let closing-text = [#closing-only{% if assets and assets.signature %}
#v(4mm)
#signature-image{% endif %}]

#let item-rows = (
{% if doc.items %}{% for item in doc.items %}  ("{{ item.pos }}", "{{ item.description }}", "{{ item.qty }}", "{{ item.price }}", "{{ item.tax }}", "{{ item.net }}"),
{% endfor %}{% endif %})

#let net-note = text(7pt, weight: "regular", fill: muted)[\ (#t("netto", "net"))]

// Item table; `prices: false` shows only position, description and quantity (delivery note)
#let items-table(prices: true) = {
  let head(body) = strong(body)
  if prices {
    table(
      columns: (auto, 1fr, auto, auto, auto, auto),
      align: (center + horizon, left + horizon, right + horizon, right + horizon, right + horizon, right + horizon),
      stroke: none,
      inset: (x: 5pt, y: 6pt),
      fill: (_, y) => if y > 0 and calc.even(y) { accent.lighten(85%) },
      table.hline(y: 0, stroke: 0.8pt),
      table.header(
        head(t("Pos.", "Item")), align(left, head(t("Bezeichnung", "Description"))), head(t("Menge", "Qty")),
        head[#t("Einzelpreis", "Unit price")#net-note], head(t("USt.", "Tax")), head[#t("Gesamtpreis", "Total")#net-note],
        table.hline(y: 1, stroke: 0.5pt),
      ),
      ..item-rows.map(r => (r.at(0), strong(lines(r.at(1))), r.at(2), r.at(3), r.at(4), r.at(5))).flatten(),
      table.hline(y: item-rows.len() + 1, stroke: 0.8pt),
    )
  } else {
    table(
      columns: (auto, 1fr, auto),
      align: (center + horizon, left + horizon, right + horizon),
      stroke: none,
      inset: (x: 5pt, y: 6pt),
      fill: (_, y) => if y > 0 and calc.even(y) { accent.lighten(85%) },
      table.hline(y: 0, stroke: 0.8pt),
      table.header(
        head(t("Pos.", "Item")), align(left, head(t("Bezeichnung", "Description"))), head(t("Menge", "Qty")),
        table.hline(y: 1, stroke: 0.5pt),
      ),
      ..item-rows.map(r => (r.at(0), strong(lines(r.at(1))), r.at(2))).flatten(),
      table.hline(y: item-rows.len() + 1, stroke: 0.8pt),
    )
  }
}

{% if doc.totals %}#let totals-block(total-label) = {
  align(right, block(width: 58%, breakable: false, {
    grid(
      columns: (1fr, auto), inset: (x: 0pt, y: 4pt), align: (left, right),
      strong(t("Gesamtpreis netto:", "Total net:")), strong("{{ doc.totals.net }}"),
      grid.hline(stroke: 0.5pt),
      {% for tax in doc.totals.taxes %}text(fill: muted)[#t("zzgl. Umsatzsteuer ", "plus VAT ")#"{{ tax.rate }}":], text(fill: muted, "{{ tax.amount }}"),
      {% endfor %}grid.hline(stroke: 1.5pt),
      text(13pt, strong(total-label)), text(13pt, strong("{{ doc.totals.gross }}")),
      grid.hline(stroke: 1.5pt),
    )
  }))
  {% if doc.totals.exempt %}v(2mm)
  small("{{ settings.exemptionReason }}")
  {% endif %}
}
{% endif %}
