import { JSONContent } from '@tiptap/core'

const JINJA_TOKEN_REGEX = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g

function escapeTypstText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/#/g, '\\#')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\$/g, '\\$')
}

function applyMarks(text: string, marks: JSONContent['marks']): string {
  if (!marks?.length) return text

  let result = text

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `*${result}*`
        break
      case 'italic':
        result = `_${result}_`
        break
      case 'underline':
        result = `#underline[${result}]`
        break
      case 'code':
        result = `\`${result}\``
        break
      default:
        break
    }
  }

  return result
}

function serializeText(node: JSONContent): string {
  const rawText = node.text ?? ''
  const segments = rawText.split(JINJA_TOKEN_REGEX)
  const escaped = segments
    .map((segment) => {
      if (!segment) return ''
      if (/^\{\{[\s\S]*\}\}$/.test(segment) || /^\{%[\s\S]*%\}$/.test(segment)) {
        return segment
      }
      return escapeTypstText(segment)
    })
    .join('')

  return applyMarks(escaped, node.marks)
}

function serializeContent(nodes: JSONContent[] | undefined): string {
  if (!nodes?.length) return ''
  return nodes.map(serializeNode).join('')
}

function serializeListItems(items: JSONContent[] | undefined, marker: '-' | '+'): string {
  if (!items?.length) return ''

  return (
    items
      .map((item) => {
        const line = serializeContent(item.content).trim()
        return `${marker} ${line}`
      })
      .join('\n') +
    '\n\n'
  )
}

function serializeSubreport(node: JSONContent): string {
  const dataSource = (node.attrs?.dataSource as string | undefined) ?? 'items'
  const rows = node.content ?? []

  const renderedRows = rows
    .map((row) => serializeContent(row.content).trim())
    .filter((row) => row.length > 0)
    .join('\n')

  return [`{% for item in ${dataSource} %}`, renderedRows, '{% endfor %}', '']
    .filter(Boolean)
    .join('\n')
}

function serializeNode(node: JSONContent): string {
  switch (node.type) {
    case 'doc':
      return serializeContent(node.content)

    case 'text':
      return serializeText(node)

    case 'paragraph': {
      const inner = serializeContent(node.content).trimEnd()
      return inner.length > 0 ? `${inner}\n\n` : '\n'
    }

    case 'heading': {
      const level = (node.attrs?.level as number | undefined) ?? 1
      const clampedLevel = Math.min(Math.max(level, 1), 6)
      const marker = '='.repeat(clampedLevel)
      return `${marker} ${serializeContent(node.content).trim()}\n\n`
    }

    case 'bulletList':
      return serializeListItems(node.content, '-')

    case 'orderedList':
      return serializeListItems(node.content, '+')

    case 'listItem':
      return serializeContent(node.content)

    case 'blockquote': {
      const inner = serializeContent(node.content).trim()
      return inner.length > 0 ? `#quote[${inner}]\n\n` : ''
    }

    case 'codeBlock': {
      const content = serializeContent(node.content).trimEnd()
      return `\`\`\`\n${content}\n\`\`\`\n\n`
    }

    case 'horizontalRule':
      return '#line(length: 100%)\n\n'

    case 'hardBreak':
      return '\\\\\n'

    case 'inlineMath':
      return `$${node.attrs?.latex ?? ''}$`

    case 'blockMath':
      return `$\n${node.attrs?.latex ?? ''}\n$\n\n`

    case 'variable': {
      const id = node.attrs?.id ?? ''
      return `{{ ${id} }}`
    }

    case 'subreport':
      return serializeSubreport(node)

    case 'subreportRow':
      return serializeContent(node.content)

    default:
      return serializeContent(node.content)
  }
}

export function tiptapToTypst(doc: JSONContent): string {
  const body = serializeContent(doc.content).trim()

  return ['#set page(margin: 2.5cm)', '#set par(justify: true)', '', body, '']
    .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''))
    .join('\n')
}
