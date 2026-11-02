// Static invoice template. Rendered by the backend with minijinja.
// Amounts, display texts and the e-invoice XML are computed in
// `backend/src/einvoice.rs`; this file only lays them out. All user text is
// passed as Typst string literals (only `\` and `"` are escaped by the
// backend); numbers, colors, fonts, units and locales are validated/whitelisted
// in `backend/src/invoice.rs`. No Typst packages except `sepay` (EPC QR code).
{% if pay.qr %}#import "@preview/sepay:0.1.1": epc-qr-code
{% endif %}
#let accent = rgb("{{ settings.accentColor }}")
#let en = "{{ settings.locale }}" == "en-de"
#let t(de, en-text) = if en { en-text } else { de }
#let lines(text) = text.split("\n").join(linebreak())
#let muted = luma(110)
#let small(body) = text(8pt, fill: muted, body)

#set document(
  title: t("Rechnung ", "Invoice ") + "{{ invoice.number }}",
  author: "{{ settings.sender.name }}",
  date: datetime(year: {{ invoice.date.year }}, month: {{ invoice.date.month }}, day: {{ invoice.date.day }}),
)
#set text(10pt, font: ("{{ settings.font }}", "Libertinus Serif"), lang: if en { "en" } else { "de" })
#set par(leading: 0.6em, spacing: 0.9em)
#set page(
  paper: "a4",
  margin: (left: 25mm, right: 20mm, top: 15mm, bottom: 25mm),
  {% if settings.footer %}footer: align(center, text(8pt, fill: luma(90), lines("{{ settings.footer }}"))),{% endif %}
  {% if settings.watermark %}background: align(center + horizon, rotate(-35deg, text(100pt, weight: "bold", fill: luma(85%), "{{ settings.watermark }}"))),{% endif %}
)
{% if einvoice %}#pdf.attach("/{{ einvoice.file }}", read("{{ assets.xml }}", encoding: none), relationship: "{{ einvoice.relationship }}", mime-type: "text/xml", description: "{{ einvoice.description }}")
{% endif %}
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

#block(height: 45mm, width: 100%, [
  #text(7pt, underline[#"{{ settings.sender.name }}", #"{{ settings.sender.address }}", #"{{ settings.sender.city }}"]) \
  #v(1mm)
  #"{{ invoice.recipient.name }}" \
  #"{{ invoice.recipient.address }}" \
  #"{{ invoice.recipient.city }}"
])

#grid(
  columns: (1fr, 1fr, 1fr),
  row-gutter: 3mm,
  {% if settings.sender.taxNr %}[#small(t("Steuernummer", "Tax ID")) \ #"{{ settings.sender.taxNr }}"],{% endif %}
  {% if settings.sender.vatId %}[#small(t("USt-IdNr.", "VAT ID")) \ #"{{ settings.sender.vatId }}"],{% endif %}
  [#small(t("Leistungszeitraum", "Period of service")) \ #"{{ invoice.dateText }}"],
  {% if invoice.recipient.buyerReference %}[#small(t("Käuferreferenz", "Buyer reference")) \ #"{{ invoice.recipient.buyerReference }}"],{% endif %}
)
#v(6mm)

#grid(
  columns: (1fr, auto),
  text(15pt, weight: "bold")[#t("Rechnung ", "Invoice ")#"{{ invoice.number }}"],
  align(bottom)[#"{{ pay.place }}", *#"{{ invoice.dateText }}"*],
)
#v(4mm)

{% if settings.intro %}#lines("{{ settings.intro }}")
#v(1em){% endif %}

#let rows = (
{% for item in invoice.items %}  ("{{ item.pos }}", "{{ item.description }}", "{{ item.qty }}", "{{ item.price }}", "{{ item.tax }}", "{{ item.net }}"),
{% endfor %})
#let head(body) = strong(body)
#let net-note = text(7pt, weight: "regular", fill: muted)[\ (#t("netto", "net"))]
#table(
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
  ..rows.map(r => (r.at(0), strong(lines(r.at(1))), r.at(2), r.at(3), r.at(4), r.at(5))).flatten(),
  table.hline(y: rows.len() + 1, stroke: 0.8pt),
)

#align(right, block(width: 58%, breakable: false, {
  grid(
    columns: (1fr, auto), inset: (x: 0pt, y: 4pt), align: (left, right),
    strong(t("Gesamtpreis netto:", "Total net:")), strong("{{ invoice.totals.net }}"),
    grid.hline(stroke: 0.5pt),
    {% for tax in invoice.totals.taxes %}text(fill: muted)[#t("zzgl. Umsatzsteuer ", "plus VAT ")#"{{ tax.rate }}" (#"{{ tax.cat }}"):], text(fill: muted, "{{ tax.amount }}"),
    {% endfor %}grid.hline(stroke: 1.5pt),
    text(13pt, strong(t("Gesamtbetrag:", "Total amount:"))), text(13pt, strong("{{ invoice.totals.gross }}")),
    grid.hline(stroke: 1.5pt),
  )
}))
{% if invoice.totals.exempt %}
#v(2mm)
#small("{{ settings.exemptionReason }}")
{% endif %}
#v(0.5em)
#let days = {{ pay.days }}
#let deadline = if days == 0 { t("sofort nach Erhalt", "upon receipt") } else if days == 1 { t("innerhalb von 1 Tag", "within 1 day") } else { t("innerhalb von " + str(days) + " Tagen", "within " + str(days) + " days") }
#let sum = strong("{{ pay.sum }}")
{% if settings.bank.iban %}#t[Bitte überweisen Sie den Gesamtbetrag in Höhe von #sum #deadline auf das unten angegebene Konto.][Please transfer the total amount of #sum #deadline to the account listed below.]

#block(breakable: false, grid(
  columns: (1fr, auto),
  [
    #t("Kontoinhaber:in", "Account holder"): #"{{ settings.sender.name }}" \
    {% if settings.bank.name %}#t("Kreditinstitut", "Bank"): #"{{ settings.bank.name }}" \
    {% endif %}IBAN: *#"{{ pay.iban }}"* \
    {% if settings.bank.bic %}BIC: #"{{ settings.bank.bic }}" \
    {% endif %}#t("Verwendungszweck", "Reference"): #"{{ invoice.number }}"
  ],
  {% if pay.qr %}box(fill: white, epc-qr-code("{{ settings.sender.name }}", "{{ pay.ibanRaw }}", {% if pay.bic %}bic: "{{ pay.bic }}", {% endif %}{% if pay.amount %}amount: {{ pay.amount }}, {% endif %}text: "{{ invoice.number }}", width: 26mm, height: 26mm)){% else %}[]{% endif %},
))
{% else %}#t[Bitte überweisen Sie den Gesamtbetrag in Höhe von #sum #deadline.][Please transfer the total amount of #sum #deadline.]
{% endif %}
{% if settings.closing %}
#v(1em)
#lines("{{ settings.closing }}")
{% endif %}
