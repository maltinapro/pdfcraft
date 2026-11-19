// Dunning letter (Mahnung): lists the open invoices with fees and default interest (§ 288 BGB)
// and asks for payment until a new deadline. Level 1 = payment reminder, 2 = dunning letter,
// 3 = final dunning letter. The sums and texts are computed in `backend/src/dunning.rs`; no
// e-invoice XML is attached. The payment block (account, EPC QR code) is the one of the invoice.
#let level = {{ doc.dunning.level }}
#let title = if level == 1 { t("Zahlungserinnerung", "Payment reminder") } else if level == 2 { t("Mahnung", "Dunning letter") } else { t("Letzte Mahnung", "Final dunning letter") }
#set document(title: title + " " + number)

#letterhead(
  (t("Neue Zahlungsfrist", "New payment deadline"), "{{ doc.dunning.deadlineText }}"),
)
#doc-heading(title, place: "{{ pay.place }}")

{% if doc.intro %}#intro-text{% else %}#if level == 1 [
  #t[Bei der Durchsicht unserer Buchhaltung haben wir festgestellt, dass die folgenden Rechnungen noch nicht beglichen wurden. Bitte überweisen Sie den offenen Betrag bis zum #due_date. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben als gegenstandslos.][When reviewing our accounts we found that the following invoices have not been paid yet. Please transfer the open amount by #due_date. If you have already made the payment, please disregard this letter.]
] else if level == 2 [
  #t[Trotz unserer Zahlungserinnerung sind die folgenden Rechnungen weiterhin offen. Wir fordern Sie auf, den Gesamtbetrag bis zum #due_date zu überweisen.][Despite our payment reminder the following invoices are still open. We ask you to transfer the total amount by #due_date.]
] else [
  #t[Trotz unserer Mahnung sind die folgenden Rechnungen weiterhin offen. Wir setzen Ihnen letztmalig eine Frist bis zum #due_date. Nach Fristablauf behalten wir uns weitere Schritte zur Durchsetzung unserer Forderung vor.][Despite our earlier dunning letter the following invoices are still open. We set you a final deadline of #due_date. After this date we reserve the right to take further steps to collect our claim.]
]
#v(1em){% endif %}
#metadata("zone 3 end") <pdfcraft-zone-3-end>
#metadata("zone 4 start") <pdfcraft-zone-4-start>
#styled-table(
  (auto, auto, auto, 1fr),
  (left + horizon, center + horizon, center + horizon, right + horizon),
  (
    table-head(t("Rechnung", "Invoice")), table-head(t("Rechnungsdatum", "Invoice date")),
    table-head(t("Fällig am", "Due date")), align(right, table-head(t("Offener Betrag", "Open amount"))),
  ),
  (
{% for inv in doc.dunning.invoices %}    strong("{{ inv.number }}"), "{{ inv.dateText }}", "{{ inv.dueText }}", "{{ inv.open }}",
{% endfor %}  ),
)
#v(4mm)
#sums-block(
  (t("Offene Rechnungsbeträge", "Open invoice amounts"), "{{ doc.dunning.openTotal }}"),
  (
{% for fee in doc.dunning.fees %}    ("{{ fee.description }}", "{{ fee.amount }}"),
{% endfor %}{% if doc.dunning.interest %}    (t("Verzugszinsen (§ 288 BGB)", "Default interest (§ 288 BGB)"), "{{ doc.dunning.interest.amount }}"),
{% endif %}  ),
  t("Gesamtforderung", "Total claim"),
  "{{ doc.dunning.total }}",
  due-label: t("Zu zahlen", "Amount due"),
)
{% if doc.dunning.interest %}#v(1mm)
#align(right, small(t("Verzugszinsen: ", "Default interest: ") + "{{ doc.dunning.interest.rate }}" + t(" p. a. vom ", " p.a. from ") + "{{ doc.dunning.interest.fromText }}" + t(" bis ", " to ") + "{{ doc.dunning.interest.toText }}"))
{% endif %}#v(0.5em)
{% if settings.bank.iban %}#t[Bitte überweisen Sie den Gesamtbetrag in Höhe von #sum bis spätestens #due_date auf das unten angegebene Konto.][Please transfer the total amount of #sum by #due_date at the latest to the account listed below.]

#bank-details
{% else %}#t[Bitte überweisen Sie den Gesamtbetrag in Höhe von #sum bis spätestens #due_date.][Please transfer the total amount of #sum by #due_date at the latest.]
{% endif %}#closing-text
#metadata("zone 4 end") <pdfcraft-zone-4-end>
