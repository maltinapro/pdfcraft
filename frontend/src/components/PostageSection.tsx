import { useEffect, useState } from 'react'
import { Field } from './Field'
import { tr, uiLocale, useLang } from '../lib/i18n'
import { ApiError } from '../lib/api'
import { buyStamp, forgetProducts, loadProducts, recoverStamp, type PostageProduct } from '../lib/postage'
import type { PostageStamp } from '../lib/types'

interface Props {
  postage: PostageStamp | null | undefined
  onChange: (postage: PostageStamp | null) => void
}

const euro = (cents: number) => (cents / 100).toLocaleString(uiLocale(), { style: 'currency', currency: 'EUR' })

/**
 * Internetmarke: buys a Deutsche Post stamp with the user's own Portokasse and prints it into the
 * address field of the document. The Portokasse login stays in this component's state only.
 */
export function PostageSection({ postage, onChange }: Props) {
  useLang()
  const [products, setProducts] = useState<PostageProduct[] | 'disabled' | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [productCode, setProductCode] = useState<number | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [buying, setBuying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [lostOrder, setLostOrder] = useState<string | null>(null)

  const load = () => {
    setLoadError(null)
    loadProducts()
      .then((list) => {
        setProducts(list)
        if (list !== 'disabled') setProductCode((current) => current ?? list[0]?.productCode ?? null)
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(load, [])

  // Without a Deutsche Post connection on the server there is nothing to offer
  if (products === 'disabled') return null

  const product = Array.isArray(products) ? products.find((p) => p.productCode === productCode) : undefined

  const buy = async () => {
    if (!product || buying) return
    const ok = window.confirm(
      tr(
        `Jetzt kostenpflichtig kaufen?\n\n${product.name} für ${euro(product.priceCents)} wird von Ihrer Portokasse abgebucht. Die Marke ist nur für einen Brief gültig.`,
        `Buy now for a fee?\n\n${product.name} for ${euro(product.priceCents)} will be charged to your Portokasse. The stamp is valid for one letter only.`,
      ),
    )
    if (!ok) return
    setBuying(true)
    setError(null)
    setLostOrder(null)
    try {
      const purchase = await buyStamp(product, username, password)
      onChange(purchase.stamp)
      setBalance(purchase.walletBalanceCents)
      setPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (e instanceof ApiError && e.code === 'postage_download_failed') {
        setLostOrder(/order (\S+)/.exec(e.details ?? '')?.[1] ?? null)
      }
      if (e instanceof Error && /price has changed|Preis hat sich/.test(e.message)) {
        forgetProducts()
        load()
      }
    } finally {
      setBuying(false)
    }
  }

  const recover = async () => {
    if (!product || !lostOrder || buying) return
    setBuying(true)
    setError(null)
    try {
      const purchase = await recoverStamp(lostOrder, product, username, password)
      onChange(purchase.stamp)
      setLostOrder(null)
      setPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuying(false)
    }
  }

  const remove = () => {
    if (
      window.confirm(
        tr(
          'Die Marke ist bereits bezahlt und lässt sich nicht erstatten. Sie wird nur aus diesem Dokument entfernt – vorher als PNG sichern, wenn Sie sie anderweitig nutzen möchten. Entfernen?',
          'The stamp is already paid for and cannot be refunded. It is only removed from this document – save it as PNG first if you want to use it elsewhere. Remove it?',
        ),
      )
    ) {
      onChange(null)
    }
  }

  return (
    <section className="form-section postage" data-field="postage" tabIndex={-1}>
      <h3>{tr('Porto / Briefmarke', 'Postage / stamp')}</h3>

      {postage ? (
        <>
          <div className="postage-stamp">
            <img src={`data:image/png;base64,${postage.base64}`} alt={tr('Internetmarke', 'Internetmarke stamp')} />
            <div>
              <strong>{postage.productName}</strong> · {euro(postage.priceCents)}
              <br />
              <span className="field-hint">
                {tr('Die Marke wird in das Adressfeld gedruckt. Mit dem Herunterladen ist sie verbraucht.', 'The stamp is printed into the address field. It is used up when you download the PDF.')}
              </span>
              {balance !== null && (
                <>
                  <br />
                  <span className="field-hint">{tr(`Restguthaben Portokasse: ${euro(balance)}`, `Portokasse balance left: ${euro(balance)}`)}</span>
                </>
              )}
            </div>
          </div>
          <div className="postage-actions">
            <a className="btn btn-small" href={`data:image/png;base64,${postage.base64}`} download={`internetmarke-${postage.voucherId || 'marke'}.png`}>
              {tr('Als PNG sichern', 'Save as PNG')}
            </a>
            <button type="button" className="btn btn-small" onClick={remove}>
              {tr('Marke entfernen', 'Remove stamp')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="field-hint">
            {tr(
              'Optional: Kaufen Sie eine Internetmarke der Deutschen Post mit Ihrer eigenen Portokasse. Sie wird direkt in das Adressfeld gedruckt. Ihre Zugangsdaten werden nur für diesen Kauf übertragen und nicht gespeichert.',
              'Optional: buy a Deutsche Post Internetmarke with your own Portokasse. It is printed directly into the address field. Your login is only sent for this purchase and is not stored.',
            )}
          </p>
          {loadError && (
            <div className="postage-error" role="alert">
              {loadError}{' '}
              <button type="button" className="btn btn-small" onClick={load}>
                {tr('Erneut laden', 'Retry')}
              </button>
            </div>
          )}
          {products === null && !loadError && <p className="field-hint">{tr('Lade Porto-Produkte …', 'Loading postage products …')}</p>}
          {Array.isArray(products) && products.length === 0 && (
            <p className="field-hint">{tr('Derzeit sind keine Porto-Produkte verfügbar.', 'No postage products are available right now.')}</p>
          )}
          {Array.isArray(products) && products.length > 0 && (
            <form
              className="postage-form"
              onSubmit={(e) => {
                e.preventDefault()
                void buy()
              }}
            >
              <Field label={tr('Porto-Produkt', 'Postage product')}>
                <select value={productCode ?? ''} onChange={(e) => setProductCode(Number(e.target.value))}>
                  {products.map((p) => (
                    <option key={p.productCode} value={p.productCode}>
                      {p.name} – {euro(p.priceCents)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('Portokasse: E-Mail-Adresse', 'Portokasse: e-mail address')}>
                <input type="email" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              <Field label={tr('Portokasse: Passwort', 'Portokasse: password')}>
                <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && (
                <div className="postage-error" role="alert">
                  {error}
                </div>
              )}
              {lostOrder && (
                <button type="button" className="btn" disabled={buying || !username.trim() || !password} onClick={() => void recover()}>
                  {tr('Bezahlte Marke erneut laden', 'Fetch paid stamp again')}
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={buying || !product || !username.trim() || !password}>
                {buying
                  ? tr('Kaufe …', 'Buying …')
                  : product
                    ? tr(`Marke kaufen (${euro(product.priceCents)})`, `Buy stamp (${euro(product.priceCents)})`)
                    : tr('Marke kaufen', 'Buy stamp')}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  )
}
