export interface XmlDisplayToken {
  kind: 'tag' | 'attribute' | 'value' | 'text' | 'comment' | 'punctuation'
  text: string
}

function escapeText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string) {
  return escapeText(value).replace(/"/g, '&quot;')
}

function serializeNode(node: Node, depth: number): string[] {
  const indent = '  '.repeat(depth)
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element
    const attrs = [...element.attributes]
      .map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`)
      .join('')
    const open = `<${element.tagName}${attrs}`
    const children = [...element.childNodes].filter(
      (child) => child.nodeType !== Node.TEXT_NODE || child.textContent?.trim(),
    )
    if (!children.length) return [`${indent}${open}/>`]

    const textOnly = children.every((child) => child.nodeType === Node.TEXT_NODE)
    if (textOnly) {
      const content = children.map((child) => escapeText(child.textContent ?? '')).join('')
      return [`${indent}${open}>${content}</${element.tagName}>`]
    }

    return [
      `${indent}${open}>`,
      ...children.flatMap((child) => serializeNode(child, depth + 1)),
      `${indent}</${element.tagName}>`,
    ]
  }
  if (node.nodeType === Node.TEXT_NODE) return [`${indent}${escapeText(node.textContent?.trim() ?? '')}`]
  if (node.nodeType === Node.CDATA_SECTION_NODE) return [`${indent}<![CDATA[${node.textContent ?? ''}]]>`]
  if (node.nodeType === Node.COMMENT_NODE) return [`${indent}<!--${node.textContent ?? ''}-->`]
  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
    const instruction = node as ProcessingInstruction
    return [`${indent}<?${instruction.target}${instruction.data ? ` ${instruction.data}` : ''}?>`]
  }
  if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
    const type = node as DocumentType
    const externalId = type.publicId
      ? ` PUBLIC "${type.publicId}"${type.systemId ? ` "${type.systemId}"` : ''}`
      : type.systemId
        ? ` SYSTEM "${type.systemId}"`
        : ''
    return [`${indent}<!DOCTYPE ${type.name}${externalId}>`]
  }
  return []
}

export function formatXml(xml: string): string {
  try {
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    if (document.querySelector('parsererror')) return xml
    const declaration = xml.match(/^\s*(<\?xml[\s\S]*?\?>)/i)?.[1]
    const nodes = [...document.childNodes]
      .filter((node) => !(node.nodeType === Node.PROCESSING_INSTRUCTION_NODE && node.nodeName === 'xml'))
      .flatMap((node) => serializeNode(node, 0))
    return [...(declaration ? [declaration] : []), ...nodes].join('\n')
  } catch {
    return xml
  }
}

function tokenizeMarkup(markup: string): XmlDisplayToken[] {
  if (markup.startsWith('<!--') || markup.startsWith('<![CDATA[') || markup.startsWith('<?') || markup.startsWith('<!DOCTYPE')) {
    return [{ kind: 'comment', text: markup }]
  }

  const tokens: XmlDisplayToken[] = []
  const openTag = markup.match(/^<(\/?)([^\s/>]+)/)
  if (!openTag) return [{ kind: 'punctuation', text: markup }]
  const prefix = openTag[1] ? '</' : '<'
  tokens.push({ kind: 'punctuation', text: prefix }, { kind: 'tag', text: openTag[2] })
  let rest = markup.slice(openTag[0].length)
  while (rest) {
    const attribute = rest.match(/^(\s+)([^\s=/>]+)(\s*=\s*)("[^"]*"|'[^']*')/)
    if (attribute) {
      tokens.push(
        { kind: 'punctuation', text: attribute[1] },
        { kind: 'attribute', text: attribute[2] },
        { kind: 'punctuation', text: attribute[3] },
        { kind: 'value', text: attribute[4] },
      )
      rest = rest.slice(attribute[0].length)
      continue
    }
    const closing = rest.match(/^(\/?>)/)
    if (closing) {
      tokens.push({ kind: 'punctuation', text: closing[1] })
      rest = rest.slice(closing[0].length)
      continue
    }
    const whitespace = rest.match(/^\s+/)
    if (whitespace) {
      tokens.push({ kind: 'punctuation', text: whitespace[0] })
      rest = rest.slice(whitespace[0].length)
      continue
    }
    const char = rest[0]
    tokens.push({ kind: 'punctuation', text: char })
    rest = rest.slice(1)
  }
  return tokens
}

export function tokenizeXml(xml: string): XmlDisplayToken[] {
  const chunks = xml.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?[^>]+>|[^<]+/g) ?? []
  return chunks.flatMap((chunk) =>
    chunk.startsWith('<') ? tokenizeMarkup(chunk) : [{ kind: 'text' as const, text: chunk }],
  )
}
