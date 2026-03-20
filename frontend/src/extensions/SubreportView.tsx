import React from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

const SubreportView: React.FC<NodeViewProps> = ({ node, updateAttributes }) => {
  return (
    <NodeViewWrapper className="subreport-wrapper">
      <div className="subreport-block">
        <div className="subreport-header">
          <span className="subreport-icon">🔁</span>
          <span className="subreport-title">SUBREPORT</span>
          <input
            className="subreport-datasource"
            value={(node.attrs as { dataSource: string }).dataSource}
            onChange={(e) => updateAttributes({ dataSource: e.target.value })}
            placeholder="dataSource"
          />
        </div>
        <div className="subreport-content">
          <NodeViewContent className="subreport-rows" />
        </div>
        <div className="subreport-footer">
          <span className="subreport-hint">
            Available: <code>{'{{item.artikel}}'}</code>, <code>{'{{item.menge}}'}</code>,{' '}
            <code>{'{{item.preis}}'}</code>
          </span>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export default SubreportView
