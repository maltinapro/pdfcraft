import { useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { VariableNode } from './extensions/VariableNode'
import { SubreportNode, SubreportRowNode } from './extensions/SubreportNode'
import { tiptapToTypst } from './lib/tiptapToTypst'
import './App.css'

const INVOICE_PRO_VARIABLES = [
  { id: 'sender.name', label: 'Absender: Name' },
  { id: 'sender.address', label: 'Absender: Adresse' },
  { id: 'sender.city', label: 'Absender: PLZ / Ort' },
  { id: 'sender.tel', label: 'Absender: Telefon' },
  { id: 'sender.email', label: 'Absender: E-Mail' },
  { id: 'sender.taxNr', label: 'Steuernummer' },
  { id: 'recipient.name', label: 'Empfänger: Name' },
  { id: 'recipient.address', label: 'Empfänger: Adresse' },
  { id: 'recipient.city', label: 'Empfänger: PLZ / Ort' },
  { id: 'invoiceNr', label: 'Rechnungsnummer' },
  { id: 'paymentGoalDays', label: 'Zahlungsziel (Tage)' },
  { id: 'bank.name', label: 'Bankname' },
  { id: 'bank.iban', label: 'IBAN' },
  { id: 'bank.bic', label: 'BIC' },
]

const INVOICE_PRO_SAMPLE_DATA = {
  sender: {
    name: 'Your Company / Name',
    address: '123 Example Street',
    city: '12345 Example City',
    tel: '+49 123 4567890',
    email: 'my-mail@domain.com',
    taxNr: '123/456/789',
    tax_nr: '123/456/789',
  },
  recipient: {
    name: 'Customer Name',
    address: '5 Customer Street',
    city: '98765 Customer City',
  },
  invoiceNr: '2026-01',
  lineItems: [
    {
      label: 'Concept and Wireframing',
      name: 'Concept and Wireframing',
      price: 1200.0,
      quantity: 1,
      unit: 'flat',
    },
    {
      label: 'UI/UX Design',
      name: 'UI/UX Design',
      price: 85.0,
      quantity: 15,
      unit: 'hrs',
    },
    {
      label: 'Frontend and Backend Development',
      name: 'Frontend and Backend Development',
      price: 95.0,
      quantity: 40,
      unit: 'hrs',
    },
    {
      label: 'Premium Hosting',
      name: 'Premium Hosting',
      price: 15.0,
      quantity: 12,
      unit: 'months',
    },
  ],
  paymentGoalDays: 14,
  bank: {
    name: 'Example Bank',
    iban: 'DE07100202005821158846',
    bic: 'EXAMPLEBICX',
  },
}

const INVOICE_PRO_TEMPLATE = String.raw`#import "@preview/invoice-pro:0.5.0": *

#show: invoice.with(
  theme: themes.DIN-5008(form: "A"),
  locale: locale.en-de,
  sender: (
    name: "{{ sender.name }}",
    address: "{{ sender.address }}",
    city: "{{ sender.city }}",
    tax-nr: "{{ sender.taxNr or sender.tax_nr }}",
  ),
  recipient: (
    name: "{{ recipient.name }}",
    address: "{{ recipient.address }}",
    city: "{{ recipient.city }}",
  ),
  invoice-nr: "{{ invoiceNr }}",
)

#line-items[
{% for item in lineItems %}
  #item(
    [#"{{ item.label or item.name }}"],
    price: {{ item.price }},
    quantity: {{ item.quantity }},
    unit: "{{ item.unit }}",
  )
{% endfor %}
]

#payment-goal(days: {{ paymentGoalDays }})

#bank-details(
  bank: "{{ bank.name }}",
  iban: "{{ bank.iban }}",
  bic: "{{ bank.bic }}",
)

#v(-.5em)
#signature()
`

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3000'

function escapeForTypstStrings<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => escapeForTypstStrings(item)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        escapeForTypstStrings(nestedValue),
      ]),
    ) as T
  }

  return value
}

const DEFAULT_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Invoice-Pro Vorlage' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Rechnungsnummer: ' },
        { type: 'variable', attrs: { id: 'invoiceNr', label: 'Rechnungsnummer' } },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Steuernummer: ' },
        { type: 'variable', attrs: { id: 'sender.taxNr', label: 'Steuernummer' } },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Absender' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'variable', attrs: { id: 'sender.name', label: 'Absender: Name' } },
        { type: 'text', text: ' · ' },
        { type: 'variable', attrs: { id: 'sender.address', label: 'Absender: Adresse' } },
        { type: 'text', text: ' · ' },
        { type: 'variable', attrs: { id: 'sender.city', label: 'Absender: PLZ / Ort' } },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Empfänger' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'variable', attrs: { id: 'recipient.name', label: 'Empfänger: Name' } },
        { type: 'text', text: ' · ' },
        { type: 'variable', attrs: { id: 'recipient.address', label: 'Empfänger: Adresse' } },
        { type: 'text', text: ' · ' },
        { type: 'variable', attrs: { id: 'recipient.city', label: 'Empfänger: PLZ / Ort' } },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Positionen' }],
    },
    {
      type: 'subreport',
      attrs: { dataSource: 'lineItems', label: 'Line Items' },
      content: [
        {
          type: 'subreportRow',
          content: [
            {
              type: 'text',
              text: '{{item.label or item.name}} · {{item.quantity}} {{item.unit}} · {{item.price}}',
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Bankdaten' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Bank: ' },
        { type: 'variable', attrs: { id: 'bank.name', label: 'Bankname' } },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'IBAN: ' },
        { type: 'variable', attrs: { id: 'bank.iban', label: 'IBAN' } },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'BIC: ' },
        { type: 'variable', attrs: { id: 'bank.bic', label: 'BIC' } },
      ],
    },
  ],
}

export default function App() {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      VariableNode,
      SubreportRowNode,
      SubreportNode,
    ],
    content: DEFAULT_CONTENT,
  })

  const insertVariable = useCallback(
    (id: string, label: string) => {
      editor?.chain().focus().insertVariable({ id, label }).run()
    },
    [editor],
  )

  const insertSubreport = useCallback(() => {
    editor
      ?.chain()
      .focus()
      .insertSubreport({ dataSource: 'lineItems', label: 'Line Items' })
      .run()
  }, [editor])

  const requestPdf = useCallback(async (template: string, data: unknown, filename = 'output.pdf') => {
    try {
      const response = await fetch(`${API_BASE_URL}/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, data }),
      })

      if (!response.ok) {
        const err = await response.text()
        alert(`PDF generation failed:\n${err}`)
        return
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const generatePDF = useCallback(async () => {
    await requestPdf(
      INVOICE_PRO_TEMPLATE,
      escapeForTypstStrings(INVOICE_PRO_SAMPLE_DATA),
      'invoice-pro.pdf',
    )
  }, [requestPdf])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="logo">📄</span> PDFCraft
        </h1>
        <p className="app-subtitle">Visual Typst Template Builder</p>
        <div className="header-actions">
          <button className="btn btn-primary btn-generate" onClick={generatePDF}>
            ⬇ Export &amp; Generate Invoice-Pro PDF
          </button>
        </div>
      </header>

      <div className="workspace">
        {/* Sidebar */}
        <aside className="sidebar">
          <section className="sidebar-section">
            <h3 className="sidebar-heading">📋 Variables</h3>
            <p className="sidebar-hint">Click to insert into editor</p>
            <div className="variable-list">
              {INVOICE_PRO_VARIABLES.map((v) => (
                <button
                  key={v.id}
                  className="variable-btn"
                  onClick={() => insertVariable(v.id, v.label)}
                  title={`Insert {{${v.id}}}`}
                >
                  <span className="variable-label">{v.label}</span>
                  <code className="variable-id">{`{{${v.id}}}`}</code>
                </button>
              ))}
            </div>
          </section>

          <section className="sidebar-section">
            <h3 className="sidebar-heading">🔁 Subreports</h3>
            <p className="sidebar-hint">Repeating data blocks</p>
            <button className="btn btn-subreport" onClick={insertSubreport}>
              + Insert Subreport
            </button>
          </section>

          <section className="sidebar-section">
            <h3 className="sidebar-heading">🧾 Invoice-Pro Sample Data</h3>
            <p className="sidebar-hint">Used for PDF generation with the current template</p>
            <pre className="sample-data">{JSON.stringify(INVOICE_PRO_SAMPLE_DATA, null, 2)}</pre>
          </section>
        </aside>

        {/* Editor */}
        <main className="editor-area">
          <div className="editor-toolbar">
            <button
              className="toolbar-btn"
              onClick={() => editor?.chain().focus().toggleBold().run()}
              title="Bold"
            >
              <b>B</b>
            </button>
            <button
              className="toolbar-btn"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              <i>I</i>
            </button>
            <button
              className="toolbar-btn"
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              title="Strikethrough"
            >
              <s>S</s>
            </button>
            <span className="toolbar-sep" />
            <button
              className="toolbar-btn"
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
              title="Heading 1"
            >
              H1
            </button>
            <button
              className="toolbar-btn"
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              title="Heading 2"
            >
              H2
            </button>
            <button
              className="toolbar-btn"
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
              title="Heading 3"
            >
              H3
            </button>
            <span className="toolbar-sep" />
            <button
              className="toolbar-btn"
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              title="Bullet List"
            >
              • List
            </button>
            <button
              className="toolbar-btn"
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              title="Ordered List"
            >
              1. List
            </button>
          </div>
          <div className="editor-container">
            <EditorContent editor={editor} className="editor-content" />
          </div>
        </main>

        {/* Typst Preview */}
        <aside className="typst-preview">
          <h3 className="sidebar-heading">📝 Typst Preview</h3>
          <pre className="typst-code">
            {editor ? tiptapToTypst(editor.getJSON()) : ''}
          </pre>
        </aside>
      </div>
    </div>
  )
}
