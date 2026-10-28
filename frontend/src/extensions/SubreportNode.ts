import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import SubreportView from './SubreportView.tsx'

export interface SubreportOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    subreport: {
      insertSubreport: (attrs: { dataSource: string; label: string }) => ReturnType
    }
  }
}

export const SubreportRowNode = Node.create({
  name: 'subreportRow',
  group: 'subreportRow',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'div[data-type="subreport-row"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'subreport-row' }, HTMLAttributes), 0]
  },
})

export const SubreportNode = Node.create<SubreportOptions>({
  name: 'subreport',
  group: 'block',
  content: 'subreportRow+',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      dataSource: {
        default: 'lineItems',
        parseHTML: (element) => element.getAttribute('data-source'),
        renderHTML: (attributes) => ({ 'data-source': attributes['dataSource'] }),
      },
      label: {
        default: 'Line Items',
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) => ({ 'data-label': attributes['label'] }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="subreport"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-type': 'subreport' }, this.options.HTMLAttributes, HTMLAttributes),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubreportView)
  },

  addCommands() {
    return {
      insertSubreport:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
            content: [
              {
                type: 'subreportRow',
                content: [
                  { type: 'text', text: '{{item.label}}' },
                  { type: 'text', text: ' · ' },
                  { type: 'text', text: '{{item.quantity}} {{item.unit}}' },
                  { type: 'text', text: ' · ' },
                  { type: 'text', text: '{{item.price}}' },
                ],
              },
            ],
          })
        },
    }
  },
})
