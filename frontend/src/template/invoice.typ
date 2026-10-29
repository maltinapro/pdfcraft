// Static invoice template (invoice-pro). Rendered by the backend with minijinja.
// All user text is passed as Typst string literals (only `\` and `"` are
// escaped by the frontend); numbers, colors, fonts, units and locales are
// validated/whitelisted in `src/lib/buildRequest.ts`.
#import "@preview/invoice-pro:0.5.0": *

#let lines(text) = text.split("\n").join(linebreak())
#let accent = rgb("{{ settings.accentColor }}")

#show: invoice.with(
  theme: theme.classic.with(
    theme.custom.brand(
      color: accent,
      font: ("{{ settings.font }}", "Libertinus Serif"),
      {% if assets and assets.logo %}logo: image("{{ assets.logo }}", alt: "Logo"),{% endif %}
    ),
    theme.custom.items-table(zebra: (none, accent.lighten(85%))),
    {% if settings.footer %}theme.custom.area("footer", arrange: (columns: (1fr,)), parts: (
      align(center, text(8pt, fill: luma(90), lines("{{ settings.footer }}"))),
    )),{% endif %}
  ),
  locale: locale.{{ settings.locale }},
  {% if settings.zugferd %}zugferd: "{{ settings.einvoiceProfile }}",
  zugferd-errors: "report",{% endif %}
  sender: (
    name: "{{ settings.sender.name }}",
    address: "{{ settings.sender.address }}",
    city: "{{ settings.sender.city }}",
    {% if settings.sender.taxNr %}tax-nr: "{{ settings.sender.taxNr }}",{% endif %}
    {% if settings.sender.vatId %}vat-id: "{{ settings.sender.vatId }}",{% endif %}
    {% if settings.sender.email %}email: "{{ settings.sender.email }}",{% endif %}
    {% if settings.sender.contactName or settings.sender.phone %}contact: (
      {% if settings.sender.contactName %}name: "{{ settings.sender.contactName }}",{% endif %}
      {% if settings.sender.phone %}phone: "{{ settings.sender.phone }}",{% endif %}
      {% if settings.sender.email %}email: "{{ settings.sender.email }}",{% endif %}
    ),{% endif %}
    {% if settings.sender.phone %}extra: ("Tel": "{{ settings.sender.phone }}"),{% endif %}
  ),
  recipient: (
    name: "{{ invoice.recipient.name }}",
    address: "{{ invoice.recipient.address }}",
    city: "{{ invoice.recipient.city }}",
    {% if invoice.recipient.vatId %}vat-id: "{{ invoice.recipient.vatId }}",{% endif %}
    {% if invoice.recipient.email %}email: "{{ invoice.recipient.email }}",{% endif %}
    {% if invoice.recipient.buyerReference %}buyer-reference: "{{ invoice.recipient.buyerReference }}",{% endif %}
  ),
  invoice-nr: "{{ invoice.number }}",
  date: datetime(year: {{ invoice.date.year }}, month: {{ invoice.date.month }}, day: {{ invoice.date.day }}),
)
#set text(10pt)

{% if settings.intro %}#lines("{{ settings.intro }}")
#v(1em){% endif %}

#line-items[
{% for item in invoice.items %}  #item(
    "{{ item.description }}",
    price: {{ item.price }},
    quantity: {{ item.quantity }},
    unit: unit.{{ item.unit }},
    tax: {% if item.taxRate == 0 %}tax.exempt(grounds: "{{ settings.exemptionReason }}"){% else %}{{ item.taxRate }}%{% endif %},
  )
{% endfor %}]

#payment-terms(days: {{ settings.paymentDays }})
{% if settings.bank.iban %}
#bank-details(
  bank: "{{ settings.bank.name }}",
  iban: "{{ settings.bank.iban }}",
  bic: "{{ settings.bank.bic }}",
)
{% endif %}
{% if settings.closing %}
#v(1em)
#lines("{{ settings.closing }}")
{% endif %}
