import { useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { VariableNode } from './extensions/VariableNode'
import { SubreportNode, SubreportRowNode } from './extensions/SubreportNode'
import { tiptapToLatex } from './lib/tiptapToLatex'
import './App.css'

const VARIABLES = [
  { id: 'kundenname', label: 'Kunden Name' },
  { id: 'datum', label: 'Datum' },
  { id: 'rechnungsnr', label: 'Rechnungs-Nr.' },
  { id: 'betrag', label: 'Betrag (netto)' },
  { id: 'mwst', label: 'MwSt. (19%)' },
  { id: 'gesamt', label: 'Gesamt (brutto)' },
]

const SAMPLE_DATA = {
  kundenname: 'Max Mustermann',
  datum: '20.03.2026',
  rechnungsnr: '2026-0042',
  betrag: '1.200,00',
  mwst: '228,00',
  gesamt: '1.428,00',
  positionen: [
    { artikel: 'Webentwicklung', menge: '8h', preis: '960,00' },
    { artikel: 'Design', menge: '4h', preis: '360,00' },
    { artikel: 'Hosting', menge: '1', preis: '108,00' },
  ],
}

const DEFAULT_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Rechnung' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Kunde: ' },
        { type: 'variable', attrs: { id: 'kundenname', label: 'Kunden Name' } },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Datum: ' },
        { type: 'variable', attrs: { id: 'datum', label: 'Datum' } },
        { type: 'text', text: '   Rechnung-Nr.: ' },
        { type: 'variable', attrs: { id: 'rechnungsnr', label: 'Rechnungs-Nr.' } },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Leistungen' }],
    },
    {
      type: 'subreport',
      attrs: { dataSource: 'positionen', label: 'Positionen' },
      content: [
        {
          type: 'subreportRow',
          content: [{ type: 'text', text: '{{item.artikel}}  ×  {{item.menge}}  →  {{item.preis}} €' }],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Zusammenfassung' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Nettobetrag: ' },
        { type: 'variable', attrs: { id: 'betrag', label: 'Betrag (netto)' } },
        { type: 'text', text: ' €' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'MwSt. (19%): ' },
        { type: 'variable', attrs: { id: 'mwst', label: 'MwSt. (19%)' } },
        { type: 'text', text: ' €' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Gesamtbetrag: ',
          marks: [{ type: 'bold' }],
        },
        { type: 'variable', attrs: { id: 'gesamt', label: 'Gesamt (brutto)' } },
        {
          type: 'text',
          text: ' €',
          marks: [{ type: 'bold' }],
        },
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
      .insertSubreport({ dataSource: 'positionen', label: 'Positionen' })
      .run()
  }, [editor])

  const generatePDF = useCallback(async () => {
    if (!editor) return
    const json = editor.getJSON()
    const template = tiptapToLatex(json)

    try {
      const response = await fetch('http://localhost:3000/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, data: SAMPLE_DATA }),
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
      a.download = 'output.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [editor])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="logo">📄</span> PDFCraft
        </h1>
        <p className="app-subtitle">Visual LaTeX Template Builder</p>
        <button className="btn btn-primary btn-generate" onClick={generatePDF}>
          ⬇ Export &amp; Generate PDF
        </button>
      </header>

      <div className="workspace">
        {/* Sidebar */}
        <aside className="sidebar">
          <section className="sidebar-section">
            <h3 className="sidebar-heading">📋 Variables</h3>
            <p className="sidebar-hint">Click to insert into editor</p>
            <div className="variable-list">
              {VARIABLES.map((v) => (
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
            <h3 className="sidebar-heading">ℹ️ Sample Data</h3>
            <pre className="sample-data">{JSON.stringify(SAMPLE_DATA, null, 2)}</pre>
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

        {/* LaTeX Preview */}
        <aside className="latex-preview">
          <h3 className="sidebar-heading">📝 LaTeX Preview</h3>
          <pre className="latex-code">
            {editor ? tiptapToLatex(editor.getJSON()) : ''}
          </pre>
        </aside>
      </div>
    </div>
  )
}
