import { JSONContent } from '@tiptap/core'

function escapeLaTeX(str: string): string {
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function serializeMarks(node: JSONContent): string {
  if (node.type !== 'text') return serializeNode(node)
  let text = node.text ?? ''
  const marks = node.marks ?? []
  for (const mark of marks) {
    if (mark.type === 'bold') text = `\\textbf{${text}}`
    else if (mark.type === 'italic') text = `\\textit{${text}}`
    else if (mark.type === 'underline') text = `\\underline{${text}}`
    else if (mark.type === 'code') text = `\\texttt{${text}}`
  }
  return text
}

function serializeContent(nodes: JSONContent[] | undefined): string {
  if (!nodes) return ''
  return nodes.map(serializeNode).join('')
}

function serializeNode(node: JSONContent): string {
  switch (node.type) {
    case 'doc':
      return serializeContent(node.content)

    case 'text': {
      const raw = node.text ?? ''
      // Don't escape minijinja template syntax {{ }}
      if (/\{\{.*?\}\}/.test(raw)) return serializeMarks(node)
      return escapeLaTeX(serializeMarks({ ...node, text: raw }))
    }

    case 'paragraph': {
      const inner = serializeContent(node.content)
      return inner ? `${inner}\n\n` : '\n'
    }

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1
      const cmds: Record<number, string> = {
        1: 'section',
        2: 'subsection',
        3: 'subsubsection',
      }
      const cmd = cmds[level] ?? 'paragraph'
      return `\\${cmd}{${serializeContent(node.content)}}\n\n`
    }

    case 'bulletList': {
      const items = (node.content ?? [])
        .map((li) => `  \\item ${serializeContent(li.content)}`)
        .join('\n')
      return `\\begin{itemize}\n${items}\n\\end{itemize}\n\n`
    }

    case 'orderedList': {
      const items = (node.content ?? [])
        .map((li) => `  \\item ${serializeContent(li.content)}`)
        .join('\n')
      return `\\begin{enumerate}\n${items}\n\\end{enumerate}\n\n`
    }

    case 'listItem':
      return serializeContent(node.content)

    case 'blockquote':
      return `\\begin{quote}\n${serializeContent(node.content)}\\end{quote}\n\n`

    case 'codeBlock':
      return `\\begin{verbatim}\n${node.attrs?.code ?? serializeContent(node.content)}\\end{verbatim}\n\n`

    case 'horizontalRule':
      return `\\noindent\\rule{\\linewidth}{0.4pt}\n\n`

    case 'hardBreak':
      return `\\\\\n`

    case 'inlineMath':
      return `$${node.attrs?.latex ?? ''}$`

    case 'blockMath':
      return `\\[\n${node.attrs?.latex ?? ''}\n\\]\n\n`

    case 'variable': {
      const id = node.attrs?.id ?? ''
      return `{{ ${id} }}`
    }

    case 'subreport': {
      const dataSource = node.attrs?.dataSource ?? 'items'
      const rows = node.content ?? []

      // Collect column headers from first row
      const firstRow = rows[0]?.content ?? []
      const colCount = Math.max(firstRow.length, 1)
      const colSpec = Array(colCount).fill('l').join(' ')

      const rowLines = rows
        .map((row) => {
          const cells = (row.content ?? [])
            .map((cell) => serializeNode(cell).trim())
            .join(' & ')
          return `  ${cells} \\\\`
        })
        .join('\n')

      return (
        `{% for item in ${dataSource} %}\n` +
        `\\begin{tabular}{${colSpec}}\n` +
        `\\toprule\n` +
        `${rowLines}\n` +
        `\\bottomrule\n` +
        `\\end{tabular}\n` +
        `{% endfor %}\n\n`
      )
    }

    case 'subreportRow':
      return serializeContent(node.content)

    default:
      return serializeContent(node.content)
  }
}

export function tiptapToLatex(doc: JSONContent): string {
  const body = serializeContent(doc.content)

  return `\\documentclass[a4paper,11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{booktabs}
\\usepackage{geometry}
\\usepackage{parskip}
\\geometry{margin=2.5cm}

\\begin{document}

${body}
\\end{document}
`
}
