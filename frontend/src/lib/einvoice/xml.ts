/**
 * Minimal XML reader for the e-invoice viewer. It works in the browser and in Node (tests) alike, ignores
 * namespace prefixes (nodes are addressed by their local name) and never resolves external or custom entities,
 * so a hostile file cannot trigger entity expansion or network requests.
 */
export interface XmlNode {
  /** Local name without namespace prefix. */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Concatenated text content of this node itself (without child elements), trimmed. */
  text: string
}

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decode(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return PREDEFINED[ref] ?? whole
  })
}

const local = (qualified: string): string => qualified.slice(qualified.indexOf(':') + 1)

const NAME_END = /[\s/>]/

/** Parses an XML document and returns its root element. Throws an `Error` for malformed XML. */
export function parseXml(source: string): XmlNode {
  let pos = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const stack: XmlNode[] = []
  const textParts: string[][] = []
  let root: XmlNode | null = null

  const fail = (message: string): never => {
    throw new Error(`XML: ${message} (position ${pos})`)
  }
  const skipTo = (marker: string, label: string) => {
    const end = source.indexOf(marker, pos)
    if (end < 0) fail(`${label} is not closed`)
    pos = end + marker.length
  }

  while (pos < source.length) {
    const lt = source.indexOf('<', pos)
    if (lt < 0) {
      if (source.slice(pos).trim()) fail('text after the root element')
      break
    }
    if (lt > pos && stack.length) textParts[textParts.length - 1].push(decode(source.slice(pos, lt)))
    pos = lt
    if (source.startsWith('<!--', pos)) skipTo('-->', 'comment')
    else if (source.startsWith('<![CDATA[', pos)) {
      const end = source.indexOf(']]>', pos)
      if (end < 0) fail('CDATA is not closed')
      if (stack.length) textParts[textParts.length - 1].push(source.slice(pos + 9, end))
      pos = end + 3
    } else if (source.startsWith('<?', pos)) skipTo('?>', 'processing instruction')
    else if (source.startsWith('<!', pos)) {
      // DOCTYPE: skipped including an internal subset; declared entities are intentionally never expanded
      const bracket = source.indexOf('[', pos)
      const close = source.indexOf('>', pos)
      if (close < 0) fail('DOCTYPE is not closed')
      if (bracket >= 0 && bracket < close) skipTo(']>', 'DOCTYPE')
      else pos = close + 1
    } else if (source.startsWith('</', pos)) {
      const end = source.indexOf('>', pos)
      if (end < 0) fail('closing tag is not closed')
      const name = local(source.slice(pos + 2, end).trim())
      const node = stack.pop()
      if (!node || node.name !== name) fail(`unexpected closing tag </${name}>`)
      node!.text = textParts.pop()!.join('').trim()
      pos = end + 1
    } else {
      let i = pos + 1
      while (i < source.length && !NAME_END.test(source[i])) i++
      const node: XmlNode = { name: local(source.slice(pos + 1, i)), attrs: {}, children: [], text: '' }
      if (!node.name) fail('empty element name')
      const attrRe = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y
      for (;;) {
        attrRe.lastIndex = i
        const m = attrRe.exec(source)
        if (!m) break
        // xmlns declarations are not needed, everything is addressed by local name
        if (m[1] !== 'xmlns' && !m[1].startsWith('xmlns:')) node.attrs[local(m[1])] = decode(m[2] ?? m[3])
        i = attrRe.lastIndex
      }
      while (i < source.length && /\s/.test(source[i])) i++
      let selfClosing = false
      if (source[i] === '/') {
        selfClosing = true
        i++
      }
      if (source[i] !== '>') {
        pos = i
        fail('malformed start tag')
      }
      pos = i + 1
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(node)
      else if (root) fail('more than one root element')
      else root = node
      if (!selfClosing) {
        stack.push(node)
        textParts.push([])
      }
    }
  }
  if (stack.length) fail(`element <${stack[stack.length - 1].name}> is not closed`)
  if (!root) fail('no root element')
  return root!
}

/** Direct children with the given local name. */
export const kids = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter((c) => c.name === name) ?? []

/** First node found by following a `/`-separated path of local names (each step takes the first match). */
export function find(node: XmlNode | undefined, path: string): XmlNode | undefined {
  let current = node
  for (const step of path.split('/')) {
    current = current?.children.find((c) => c.name === step)
    if (!current) return undefined
  }
  return current
}

/** All nodes at the end of a path (every branch is followed). */
export function findAll(node: XmlNode | undefined, path: string): XmlNode[] {
  let level = node ? [node] : []
  for (const step of path.split('/')) level = level.flatMap((n) => n.children.filter((c) => c.name === step))
  return level
}

/** Text at the end of a path, or `undefined` when missing or empty. */
export function text(node: XmlNode | undefined, path: string): string | undefined {
  const value = find(node, path)?.text
  return value ? value : undefined
}
