import type { ReactNode } from 'react'
import { Dialog } from '@pdfcraft/editor'

interface Props {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}

export function BottomSheet(props: Props) {
  return <Dialog {...props} className="ui-bottom-sheet" />
}
