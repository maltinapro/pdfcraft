// Shared layout of all PDF documents (invoice, credit note, offer, order, delivery note, letter,
// dunning letter, report).
// The backend prepends this file to the template of the document type and renders both with
// minijinja (`backend/src/v1.rs`, `backend/src/documents.rs`). Amounts, dates and display texts are
// computed in the backend; user text is passed as Typst string literals (only `\` and `"` are
// escaped there). The look is chosen by `settings.design`: every design is one dictionary of tokens
// (see `designs` below) that the layout functions read, so the document types cannot drift apart.
// DIN 5008 Form B positions are the same in every design: margins 25/20/20 mm, header up to 45 mm,
// address field 45-92.4 mm, fold marks (105 / 210 mm) and punch mark (148.5 mm). The report has no
// address field or marks: margins 20/15/15/20 mm, optional landscape, page numbers in the footer.
{% set d = invoice or doc %}{% set is_report = doc and doc.kind == "report" %}{% set intro = settings.intro if invoice else doc.intro %}{% set closing = settings.closing if invoice else doc.closing %}{% if pay and pay.qr %}#import "@preview/sepay:0.1.1": epc-qr-code
{% endif %}
#let accent = rgb("{{ settings.accentColor }}")
#let design = "{{ settings.design }}"
#let en = "{{ settings.locale }}" == "en-de"
#let t(de, en-text) = if en { en-text } else { de }
#let lines(text) = text.split("\n").join(linebreak())
#let muted = luma(110)
#let small(body) = text(8pt, fill: muted, body)

// Colors: text on the accent switches to dark when the accent is too light for white text, and
// accent-colored text on white is darkened until it is legible.
#let channel(c) = {
  let v = float(c)
  if v <= 0.03928 { v / 12.92 } else { calc.pow((v + 0.055) / 1.055, 2.4) }
}
#let luminance(c) = {
  let (r, g, b) = c.rgb().components(alpha: false)
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
#let contrast(a, b) = {
  let (hi, lo) = (calc.max(luminance(a), luminance(b)), calc.min(luminance(a), luminance(b)))
  (hi + 0.05) / (lo + 0.05)
}
#let dark = rgb("#1b1b1f")
#let on-accent = if contrast(accent, white) >= contrast(accent, dark) { white } else { dark }
#let accent-ink = {
  let c = accent
  for _ in range(12) {
    if contrast(c, white) < 3 { c = c.darken(12%) }
  }
  c
}

// Design tokens. A new design = one dictionary here + the allow-list in `backend/src/invoice.rs`
// and `frontend/src/lib/types.ts` + a picker thumbnail.
#let designs = (
  classic: (
    header: "split", meta: "grid", title: "inline", title-size: 15pt, title-fill: black,
    table: "ruled", totals: "ruled", payment: "plain", footer: "centered",
  ),
  modern-minimal: (
    header: "minimal", meta: "info", title: "stacked", title-size: 24pt, title-fill: accent-ink,
    table: "hairline", totals: "airy", payment: "hairline", footer: "left",
  ),
  contrast: (
    header: "band", meta: "chips", title: "inline", title-size: 18pt, title-fill: accent-ink,
    table: "filled", totals: "boxed", payment: "card", footer: "ruled",
  ),
)
#let tokens = designs.at(design)

#let margin-left = {% if is_report %}20mm{% else %}25mm{% endif %}
#let page-width = {% if is_report and doc.report.landscape %}297mm{% else %}210mm{% endif %}
#let number = "{{ d.number }}"
#let date-text = "{{ d.dateText }}"

#set text(10pt, font: ("{{ settings.font }}", "Libertinus Serif"), lang: if en { "en" } else { "de" })
#set par(leading: 0.6em, spacing: 0.9em)
#set document(
  author: "{{ settings.sender.name }}",
  {% if invoice %}date: datetime(year: {{ invoice.date.year }}, month: {{ invoice.date.month }}, day: {{ invoice.date.day }}),{% else %}date: datetime(year: {{ doc.year }}, month: {{ doc.month }}, day: {{ doc.day }}),{% endif %}
)

#let footer-text(body) = if tokens.footer == "left" {
  align(left, text(8pt, fill: muted, body))
} else if tokens.footer == "ruled" {
  block(width: 100%, stroke: (top: 0.8pt + accent-ink), inset: (top: 3pt), align(center, text(8pt, fill: luma(90), body)))
} else {
  align(center, text(8pt, fill: luma(90), body))
}
#set page(
  paper: "a4",
  {% if is_report %}flipped: {% if doc.report.landscape %}true{% else %}false{% endif %},
  margin: (left: 20mm, right: 15mm, top: 15mm, bottom: 20mm),
  footer: footer-text[{% if settings.footer %}#lines("{{ settings.footer }}") \
    {% endif %}#"{{ doc.report.title }}"{% if doc.report.period %} · #"{{ doc.report.period }}"{% endif %} · #t[Seite][Page] #context counter(page).display() #t[von][of] #context counter(page).final().first()],
  {% else %}margin: (left: 25mm, right: 20mm, top: 15mm, bottom: 20mm),
  {% if settings.footer %}footer: footer-text(lines("{{ settings.footer }}")),{% endif %}{% endif %}
  background: [
    {% if not is_report %}// DIN 5008 fold marks (105 / 210 mm) and punch mark (148.5 mm)
    #place(top + left, dy: 105mm, dx: 5mm, line(length: 4mm, stroke: 0.4pt + luma(120)))
    #place(top + left, dy: 210mm, dx: 5mm, line(length: 4mm, stroke: 0.4pt + luma(120)))
    #place(top + left, dy: 148.5mm, dx: 5mm, line(length: 8mm, stroke: 0.4pt + luma(120)))
    {% endif %}    {% if settings.watermark %}#align(center + horizon, rotate(-35deg, text(100pt, weight: "bold", fill: luma(85%), "{{ settings.watermark }}"))){% endif %}
  ],
)
{% if einvoice %}#pdf.attach("/{{ einvoice.file }}", read("{{ assets.xml }}", encoding: none), relationship: "{{ einvoice.relationship }}", mime-type: "text/xml", description: "{{ einvoice.description }}")
{% endif %}{% if audit %}#pdf.attach("/{{ audit.file }}", read("{{ assets.audit }}", encoding: none), relationship: "supplement", mime-type: "application/json", description: "{{ audit.description }}")
{% endif %}
// Header (DIN 5008, window envelope: the address starts at 45 mm)
#let has-logo = {% if assets and assets.logo %}true{% else %}false{% endif %}
#let logo(height) = {% if assets and assets.logo %}image("{{ assets.logo }}", height: height, fit: "contain", alt: "Logo"){% else %}[]{% endif %}
#let sender-details = [
  #"{{ settings.sender.address }}" \
  #"{{ settings.sender.city }}"
  {% if settings.sender.email %}\ #"{{ settings.sender.email }}"{% endif %}
  {% if settings.sender.phone %}\ Tel: #"{{ settings.sender.phone }}"{% endif %}
]
#let sender-lines = [*#"{{ settings.sender.name }}"* \ #sender-details]
#let sender-line = [*#"{{ settings.sender.name }}"* · #"{{ settings.sender.address }}" · #"{{ settings.sender.city }}"{% if settings.sender.email %} · #"{{ settings.sender.email }}"{% endif %}{% if settings.sender.phone %} · Tel: #"{{ settings.sender.phone }}"{% endif %}]

#let header() = if tokens.header == "minimal" {
  // small logo, the sender as one muted line below it
  block(height: 30mm, width: 100%, {
    if has-logo {
      logo(12mm)
      v(3mm)
    }
    text(8pt, fill: muted, sender-line)
  })
} else if tokens.header == "band" {
  // full-bleed accent band (0-27 mm) with the sender in on-accent color, logo on a white plate
  block(height: 30mm, width: 100%, {
    place(top + left, dx: -margin-left, dy: -15mm, rect(width: page-width, height: 27mm, fill: accent, stroke: none))
    place(top + left, dy: -15mm, block(height: 27mm, width: 100%, align(horizon, grid(
      columns: (1fr, 1fr),
      align: horizon,
      if has-logo {
        box(fill: white, radius: 3mm, inset: 2mm, logo(17mm))
      } else {
        text(15pt, weight: "bold", fill: on-accent, "{{ settings.sender.name }}")
      },
      align(right, text(9pt, fill: on-accent, if has-logo { sender-lines } else { sender-details })),
    ))))
  })
} else {
  block(height: 30mm, width: 100%, grid(
    columns: (1fr, 1fr),
    logo(24mm),
    align(right, sender-lines),
  ))
}

// Address field (85 mm wide, 45-92.4 mm); the franking mark (Internetmarke) sits in its top right
// corner and the recipient starts below it. `info` is the DIN information block right of it.
#let address-height = {% if d.postage %}calc.max(47.4mm, {{ d.postage.heightMm }}mm + 20mm){% else %}47.4mm{% endif %}
#let address-lines = [
  {% if d.postage %}#place(top + left, dx: 85mm - {{ d.postage.widthMm }}mm, image("{{ assets.postage }}", width: {{ d.postage.widthMm }}mm, alt: "Frankiervermerk"))
  #box(width: 83mm - {{ d.postage.widthMm }}mm, text(7pt, underline[#"{{ settings.sender.name }}", #"{{ settings.sender.address }}", #"{{ settings.sender.city }}"])) \
  #v(1mm + calc.max(0mm, {{ d.postage.heightMm }}mm - 3.5mm))
  {% else %}#text(7pt, underline[#"{{ settings.sender.name }}", #"{{ settings.sender.address }}", #"{{ settings.sender.city }}"]) \
  #v(1mm)
  {% endif %}  #"{{ d.recipient.name }}" \
  #"{{ d.recipient.address }}" \
  #"{{ d.recipient.city }}"
]
#let address-block(info: none) = block(height: address-height, width: 100%, if info == none {
  address-lines
} else {
  grid(columns: (85mm, 1fr), column-gutter: 15mm, address-lines, info)
})

// Small label/value pairs: a 3-column grid below the address (classic), tinted chips (contrast) or
// the DIN information block right of the address field (modern minimal)
#let facts-grid(entries, columns: 3) = grid(
  columns: (1fr,) * columns,
  row-gutter: 3mm,
  ..entries.map(e => [#small(e.at(0)) \ #e.at(1)]),
)
#let facts-chips(entries, columns: 3) = grid(
  columns: (1fr,) * columns,
  column-gutter: 3mm,
  row-gutter: 3mm,
  ..entries.map(e => block(width: 100%, fill: accent.lighten(88%), radius: 2mm, inset: (x: 3mm, y: 2mm), [#small(e.at(0)) \ #e.at(1)])),
)
#let info-block(entries) = grid(
  row-gutter: 2.5mm,
  ..entries.map(e => [#small(e.at(0)) \ #e.at(1)]),
)

// Header, address field and the label/value entries (entries with `none` are skipped). The date is
// part of the information block in the modern design and of the title row otherwise; `with-date`
// adds it to the entries of the other designs as well (letter).
#let letterhead(..entries, date-label: t("Datum", "Date"), with-date: false) = {
  let shown = entries.pos().filter(e => e.at(1) != none and e.at(1) != "")
  let dated = ((date-label, date-text),)
  let shown = if tokens.meta == "info" { dated + shown } else if with-date { shown + dated } else { shown }
  header()
  // the information block fits four entries next to the address, further ones go below it
  let beside = if tokens.meta == "info" { shown.slice(0, calc.min(shown.len(), 4)) } else { () }
  let below = if tokens.meta == "info" { shown.slice(beside.len()) } else { shown }
  address-block(info: if beside.len() > 0 { info-block(beside) })
  [#metadata("zone 3 start") <pdfcraft-zone-3-start>]
  if below.len() > 0 {
    if tokens.meta == "chips" { facts-chips(below) } else { facts-grid(below) }
    v(6mm)
  } else if tokens.meta == "info" {
    v(6mm)
  }
}

// Title row: type and number, place and date (the date moved to the information block in the
// modern design, which shows a muted type label above a large number instead)
#let doc-heading(label, with-number: true, place: none) = {
  let shown-number = if with-number and number != "" { number } else { none }
  if tokens.title == "stacked" {
    if shown-number != none {
      text(8.5pt, fill: muted, tracking: 0.8pt, upper(label))
      linebreak()
    }
    text(tokens.title-size, weight: "bold", fill: tokens.title-fill, if shown-number != none { shown-number } else { label })
    v(4mm)
  } else {
    grid(
      columns: (1fr, auto),
      text(tokens.title-size, weight: "bold", fill: tokens.title-fill)[#label#if shown-number != none [ #shown-number]],
      align(bottom)[#if place != none [#place, *#date-text*] else [#date-text]],
    )
    v(4mm)
  }
}

#let intro-text = [{% if intro %}#lines("{{ intro }}")
#v(1em){% endif %}]
#let closing-only = [{% if closing %}#v(1em)
#lines("{{ closing }}"){% endif %}]

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
{% if d.items %}{% for item in d.items %}  ("{{ item.pos }}", "{{ item.description }}", "{{ item.qty }}", "{{ item.price }}", "{{ item.tax }}", "{{ item.net }}"),
{% endfor %}{% endif %})

// Table in the design's style (ruled / hairline / filled); `heads` are built with `table-head`
#let table-head(body) = if tokens.table == "hairline" {
  text(7.5pt, fill: muted, tracking: 0.5pt, upper(body))
} else if tokens.table == "filled" {
  text(fill: on-accent, strong(body))
} else {
  strong(body)
}
#let styled-table(columns, align, heads, cells, row-count: none) = {
  let ruled = tokens.table == "ruled"
  let hairline = tokens.table == "hairline"
  let filled = tokens.table == "filled"
  let rows = if row-count == none { calc.quo(cells.len(), heads.len()) } else { row-count }
  let zebra = if ruled { accent.lighten(85%) } else if filled { accent.lighten(92%) } else { none }
  let tbl = table(
    columns: columns,
    align: align,
    stroke: if hairline { (_, y) => if y > 0 { (bottom: 0.4pt + luma(220)) } } else { none },
    inset: if hairline { (x: 5pt, y: 7pt) } else { (x: 5pt, y: 6pt) },
    fill: (_, y) => if filled and y == 0 { accent } else if y > 0 and calc.even(y) { zebra },
    ..if ruled { (table.hline(y: 0, stroke: 0.8pt),) } else { () },
    table.header(
      ..heads,
      ..if ruled { (table.hline(y: 1, stroke: 0.5pt),) } else if hairline { (table.hline(y: 1, stroke: 0.6pt + luma(150)),) } else { () },
    ),
    ..cells,
    ..if ruled { (table.hline(y: rows + 1, stroke: 0.8pt),) } else { () },
  )
  if filled { block(radius: 3pt, clip: true, tbl) } else { tbl }
}

// Item table; `prices: false` shows only position, description and quantity (delivery note)
#let items-table(prices: true) = {
  let hairline = tokens.table == "hairline"
  let filled = tokens.table == "filled"
  let net-note = text(7pt, weight: "regular", fill: if filled { on-accent } else { muted })[\ (#t("netto", "net"))]
  let description(s) = if hairline { lines(s) } else { strong(lines(s)) }
  let heads = if prices {
    (
      table-head(t("Pos.", "Item")), align(left, table-head(t("Bezeichnung", "Description"))), table-head(t("Menge", "Qty")),
      table-head[#t("Einzelpreis", "Unit price")#net-note], table-head(t("USt.", "Tax")), table-head[#t("Gesamtpreis", "Total")#net-note],
    )
  } else {
    (table-head(t("Pos.", "Item")), align(left, table-head(t("Bezeichnung", "Description"))), table-head(t("Menge", "Qty")))
  }
  let body = item-rows.map(r => if prices {
    (r.at(0), description(r.at(1)), r.at(2), r.at(3), r.at(4), r.at(5))
  } else {
    (r.at(0), description(r.at(1)), r.at(2))
  }).flatten()
  styled-table(
    if prices { (auto, 1fr, auto, auto, auto, auto) } else { (auto, 1fr, auto) },
    if prices {
      (center + horizon, left + horizon, right + horizon, right + horizon, right + horizon, right + horizon)
    } else {
      (center + horizon, left + horizon, right + horizon)
    },
    heads,
    body,
  )
}

// Sums block: `first` is the first (bold in classic) line as `(label, value)`, `rows` the further
// lines, then the total. `due-label` is the modern design's "Amount due".
#let sums-block(first, rows, total-label, total, due-label: none) = align(right, block(width: 58%, breakable: false, if tokens.totals == "ruled" {
  grid(
    columns: (1fr, auto), inset: (x: 0pt, y: 4pt), align: (left, right),
    strong([#first.at(0):]), strong(first.at(1)),
    grid.hline(stroke: 0.5pt),
    ..rows.map(r => (text(fill: muted, [#r.at(0):]), text(fill: muted, r.at(1)))).flatten(),
    grid.hline(stroke: 1.5pt),
    text(13pt, strong([#total-label:])), text(13pt, strong(total)),
    grid.hline(stroke: 1.5pt),
  )
} else {
  let sums = grid(
    columns: (1fr, auto), inset: (x: 0pt, y: 3pt), align: (left, right),
    text(fill: muted, first.at(0)), text(fill: muted, first.at(1)),
    ..rows.map(r => (text(fill: muted, r.at(0)), text(fill: muted, r.at(1)))).flatten(),
  )
  if tokens.totals == "airy" {
    sums
    v(3mm)
    align(right)[#text(8pt, fill: muted, tracking: 0.6pt, upper(if due-label != none { due-label } else { total-label })) \ #text(20pt, weight: "bold", fill: accent-ink, total)]
  } else {
    sums
    v(1mm)
    rect(width: 100%, fill: accent, radius: 3pt, inset: (x: 8pt, y: 7pt), text(13pt, weight: "bold", fill: on-accent, grid(
      columns: (1fr, auto), align: (left, right), [#total-label], total,
    )))
  }
}))

{% if d.totals %}// Totals: net, one line per VAT rate (with the tax category letter only when the document mixes
// categories, then with a legend) and the total.
#let tax-rows = (
{% for tax in d.totals.taxes %}  ([#t("zzgl. Umsatzsteuer ", "plus VAT ")#"{{ tax.rate }}"{% if d.totals.mixed %} (#"{{ tax.cat }}"){% endif %}], "{{ tax.amount }}"),
{% endfor %})
#let totals-block(total-label, due-label: none) = {
  sums-block((t("Gesamtpreis netto", "Total net"), "{{ d.totals.net }}"), tax-rows, total-label, "{{ d.totals.gross }}", due-label: due-label)
  {% if d.totals.exempt %}v(2mm)
  small("{{ settings.exemptionReason }}")
  {% endif %}{% if d.totals.mixed %}v(1mm)
  small(t("Steuerkategorie: S = steuerpflichtig, E = steuerbefreit", "Tax category: S = standard rate, E = exempt"))
  {% endif %}
}
{% endif %}
{% if pay %}// Payment (invoice, dunning letter): due date, total and the account with the EPC QR code
#let due_date = "{{ pay.dueDate }}"
#let sum = strong("{{ pay.sum }}")
#let bank-frame(body) = if tokens.payment == "hairline" {
  block(breakable: false, {
    line(length: 100%, stroke: 0.4pt + luma(200))
    v(1mm)
    body
  })
} else if tokens.payment == "card" {
  block(breakable: false, width: 100%, fill: accent.lighten(92%), radius: 3pt, inset: 10pt, body)
} else {
  block(breakable: false, body)
}
#let bank-details = [{% if settings.bank.iban %}#bank-frame(grid(
  columns: (1fr, auto),
  [
    #t("Kontoinhaber:in", "Account holder"): #"{{ settings.sender.name }}" \
    {% if settings.bank.name %}#t("Kreditinstitut", "Bank"): #"{{ settings.bank.name }}" \
    {% endif %}IBAN: *#"{{ pay.iban }}"* \
    {% if settings.bank.bic %}BIC: #"{{ settings.bank.bic }}" \
    {% endif %}#t("Verwendungszweck", "Reference"): #"{{ d.number }}"
  ],
  {% if pay.qr %}box(fill: white, epc-qr-code("{{ settings.sender.name }}", "{{ pay.ibanRaw }}", {% if pay.bic %}bic: "{{ pay.bic }}", {% endif %}{% if pay.amount %}amount: {{ pay.amount }}, {% endif %}text: "{{ d.number }}", width: 26mm, height: 26mm)){% else %}[]{% endif %},
)){% endif %}]
{% if pay.days is defined %}#let days = {{ pay.days }}
#let deadline = if days == 0 { t("sofort nach Erhalt", "upon receipt") } else if days == 1 { t("innerhalb von 1 Tag", "within 1 day") } else { t("innerhalb von " + str(days) + " Tagen", "within " + str(days) + " days") }
#let payment-block = [
{% if settings.bank.iban %}#t[Bitte überweisen Sie den Gesamtbetrag in Höhe von #sum #deadline auf das unten angegebene Konto.][Please transfer the total amount of #sum #deadline to the account listed below.]

#t[Zahlbar bis: #due_date.][Due by: #due_date.]

#bank-details
{% else %}#t[Bitte überweisen Sie den Gesamtbetrag in Höhe von #sum #deadline.][Please transfer the total amount of #sum #deadline.]

#t[Zahlbar bis: #due_date.][Due by: #due_date.]
{% endif %}]
{% endif %}{% endif %}
