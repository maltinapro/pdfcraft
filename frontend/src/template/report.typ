// Report (tabular document): title, meta block and one or more tables with typed columns, group
// subtotals and totals. The table header repeats on every page and the footer shows "Seite x von y".
// Sums and number formatting are computed in `backend/src/report.rs`; no e-invoice XML is attached.
// Table rows come as arrays whose first entry is the kind: r = row, g = group heading, s = subtotal,
// t = total. Margins and the optional landscape format are set in `layout.typ`.
#set document(title: "{{ doc.report.title }}")

#let report-tables = (
{% for tb in doc.report.tables %}  (
    title: "{{ tb.title }}",
    heads: ({% for c in tb.columns %}("{{ c.label }}", {{ c.align }}), {% endfor %}),
    widths: ({% for w in tb.widths %}{{ w }}, {% endfor %}),
    rows: (
{% for r in tb.rows %}      ({% for c in r %}"{{ c }}", {% endfor %}),
{% endfor %}    ),
  ),
{% endfor %})

#let report-table(heads, widths, rows) = {
  let n = heads.len()
  let ruled = tokens.table == "ruled"
  let hairline = tokens.table == "hairline"
  let filled = tokens.table == "filled"
  let kinds = rows.map(r => r.at(0))
  let ink(k, body) = if k == "r" {
    body
  } else if k == "t" and filled {
    text(fill: on-accent, strong(body))
  } else if hairline and k != "r" {
    text(fill: accent-ink, strong(body))
  } else {
    strong(body)
  }
  let cells = ()
  let y = 0
  for r in rows {
    y += 1
    let k = r.at(0)
    if k == "g" {
      cells.push(table.cell(colspan: n, align: left + horizon, ink(k, lines(r.at(1)))))
    } else {
      if ruled and k == "s" { cells.push(table.hline(y: y, stroke: 0.4pt)) }
      if k == "t" {
        if ruled { cells.push(table.hline(y: y, stroke: 0.8pt)) }
        if hairline { cells.push(table.hline(y: y, stroke: 0.8pt + accent-ink)) }
      }
      for c in r.slice(1) { cells.push(ink(k, lines(c))) }
    }
  }
  let zebra = if ruled { accent.lighten(85%) } else if filled { accent.lighten(92%) } else { none }
  table(
    columns: widths,
    align: heads.map(h => h.at(1) + horizon),
    stroke: if hairline { (_, y) => if y > 0 { (bottom: 0.4pt + luma(220)) } } else { none },
    inset: if hairline { (x: 5pt, y: 5pt) } else { (x: 5pt, y: 4pt) },
    fill: (_, y) => if y == 0 {
      if filled { accent }
    } else {
      let k = kinds.at(y - 1)
      if k == "g" and not hairline { accent.lighten(70%) }
      else if k == "s" and filled { accent.lighten(84%) }
      else if k == "t" and filled { accent }
      else if k == "r" and calc.even(y) { zebra }
    },
    ..if ruled { (table.hline(y: 0, stroke: 0.8pt),) } else { () },
    table.header(
      ..heads.map(h => table-head(h.at(0))),
      ..if ruled { (table.hline(y: 1, stroke: 0.5pt),) } else if hairline { (table.hline(y: 1, stroke: 0.6pt + luma(150)),) } else { () },
    ),
    ..cells,
    ..if ruled { (table.hline(y: rows.len() + 1, stroke: 0.8pt),) } else { () },
  )
}

#header()
#doc-heading("{{ doc.report.title }}", with-number: false)

#let facts = (if tokens.meta == "info" { ((t("Datum", "Date"), date-text),) } else { () }) + (
  {% if doc.report.period %}(t("Zeitraum", "Period"), "{{ doc.report.period }}"),{% endif %}
  {% if doc.number %}(t("Nummer", "Number"), "{{ doc.number }}"),{% endif %}
{% for m in doc.report.meta %}{% if m.value %}  ("{{ m.label }}", "{{ m.value }}"),
{% endif %}{% endfor %})
#if facts.len() > 0 {
  let columns = {% if doc.report.landscape %}4{% else %}3{% endif %}
  if tokens.meta == "chips" { facts-chips(facts, columns: columns) } else { facts-grid(facts, columns: columns) }
  v(6mm)
}

#intro-text
#show table: set text(9pt, features: ("tnum",))
#for (i, tb) in report-tables.enumerate() {
  if i > 0 { v(6mm) }
  if tb.title != "" {
    block(sticky: true, below: 3mm, text(11pt, weight: "bold", tb.title))
  }
  report-table(tb.heads, tb.widths, tb.rows)
}
#closing-text
