import type { Contact, Doc, EditorAdapter, Invoice, RenderRequest, SaveResult } from '@maltinapro/pdfcraft-editor'
import { requestDocument, requestPdf } from './api'
import { reportClientError } from './clientErrors'
import { extractEInvoice } from './einvoice/extract'
import { getMasterData, saveArticleFromItem, saveRecipient, setMasterData, subscribeMasterData } from './masterData'
import { postageAdapter } from './postage'
import { routeHref } from './router'

const saved = (result: { data: Parameters<typeof setMasterData>[0]; updated: boolean }): SaveResult => ({
  ok: setMasterData(result.data),
  updated: result.updated,
})

/** Connects the paper-first editor (`@maltinapro/pdfcraft-editor`) to this app: `/v1` for rendering, the browser storage for master data. */
export const editorAdapter: EditorAdapter = {
  render: ({ kind, settings, document }: RenderRequest, signal) =>
    kind === 'invoice' ? requestPdf(settings, document as Invoice, signal) : requestDocument(kind, settings, document as Doc, signal),
  customers: {
    list: () => getMasterData().contacts as readonly Contact[],
    subscribe: subscribeMasterData,
    save: (recipient) => saved(saveRecipient(getMasterData(), recipient)),
    manageHref: routeHref('contacts'),
  },
  articles: {
    list: () => getMasterData().articles,
    subscribe: subscribeMasterData,
    save: (item) => saved(saveArticleFromItem(getMasterData(), item)),
    manageHref: routeHref('articles'),
  },
  postage: postageAdapter,
  extractXml: async (pdf, fileName) => {
    try {
      return (await extractEInvoice(new Uint8Array(await pdf.arrayBuffer()), fileName)).xml
    } catch {
      return null
    }
  },
  reportError: reportClientError,
}
