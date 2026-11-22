import { Dialog } from '@maltinapro/design'
import { tr } from '../../lib/i18n'
import { formatXml, tokenizeXml } from '../../lib/xmlDisplay'

interface Props {
  xml: string | null
  error: string | null
  onClose: () => void
}

export function XmlDialog({ xml, error, onClose }: Props) {
  return (
    <Dialog open title={tr('E-Rechnungs-XML', 'E-invoice XML')} onClose={onClose} className="xml-dialog">
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <pre>{tokenizeXml(formatXml(xml ?? '')).map((token, index) => (
          <span className={`xml-token-${token.kind}`} key={index}>{token.text}</span>
        ))}</pre>
      )}
      <button type="button" className="btn btn-tonal" onClick={onClose}>{tr('Schließen', 'Close')}</button>
    </Dialog>
  )
}
