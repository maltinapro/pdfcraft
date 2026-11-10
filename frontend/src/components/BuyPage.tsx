import { useCallback, useEffect, useState } from 'react'
import { AppHeader } from './AppHeader'
import { HeaderNav } from './HeaderNav'
import { ThemeToggle } from './ThemeToggle'
import { loadPaidToken, savePaidToken, type PaidToken } from '../lib/api'
import { tr, uiLocale, useLang } from '../lib/i18n'
import {
  cancelSubscription,
  claimToken,
  fetchTokenInfo,
  loadPending,
  savePending,
  startCheckout,
  useOffers,
  type Offer,
  type TokenInfo,
} from '../lib/purchase'

interface Props {
  unsaved: number
}

const POLL_MS = 3000
const POLL_TRIES = 20

const planName = (plan: string) => plan.charAt(0).toUpperCase() + plan.slice(1)

function duration(days: number): string {
  if (days === 1) return tr('Tagespass (1 Tag)', 'Day pass (1 day)')
  if (days >= 28 && days <= 31) return tr(`Monat (${days} Tage)`, `Month (${days} days)`)
  return tr(`${days} Tage`, `${days} days`)
}

function price(amount: string, currency: string): string {
  return new Intl.NumberFormat(uiLocale(), { style: 'currency', currency }).format(Number(amount))
}

type Collecting = 'idle' | 'waiting' | 'slow'

/** Buy a token, renew or cancel it. Only reachable when the backend has purchases enabled. */
export function BuyPage({ unsaved }: Props) {
  useLang()
  const { currency, offers } = useOffers()
  const [paid, setPaid] = useState<PaidToken | null>(loadPaidToken)
  const [info, setInfo] = useState<TokenInfo | null>(null)
  const [collecting, setCollecting] = useState<Collecting>(loadPending() ? 'waiting' : 'idle')
  const [fresh, setFresh] = useState(false)
  const [subscription, setSubscription] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [shown, setShown] = useState(false)

  const refresh = useCallback(async () => {
    const current = await fetchTokenInfo()
    setInfo(current)
    setPaid(loadPaidToken())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // After the payment: collect the new token (or wait for the renewal) while the webhook arrives
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const pending = loadPending()
    if (!pending) return
    let cancelled = false
    setCollecting('waiting')
    void (async () => {
      for (let i = 0; i < POLL_TRIES && !cancelled; i++) {
        try {
          if (pending.renewal) {
            const current = await fetchTokenInfo()
            if (current?.expiresAt && current.expiresAt > (pending.previousEnd ?? 0)) {
              savePending(null)
              setCollecting('idle')
              setMessage(tr('Zahlung erhalten – Ihr Token wurde verlängert.', 'Payment received – your token was extended.'))
              await refresh()
              return
            }
          } else if (await claimToken(pending.order)) {
            savePending(null)
            setCollecting('idle')
            setFresh(true)
            setShown(true)
            await refresh()
            return
          }
        } catch (e) {
          if (!cancelled) setMessage(e instanceof Error ? e.message : String(e))
        }
        await new Promise((resolve) => window.setTimeout(resolve, POLL_MS))
      }
      if (!cancelled) setCollecting('slow')
    })()
    return () => {
      cancelled = true
    }
  }, [attempt, refresh])

  const buy = async (offer: Offer, renew?: PaidToken) => {
    setBusy(`${offer.plan}:${offer.days}`)
    setMessage(null)
    try {
      window.location.href = await startCheckout(offer, { subscription, renew })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const cancel = async () => {
    const ok = window.confirm(
      tr(
        'Abonnement kündigen? Es wird nichts mehr abgebucht. Das Token bleibt bis zum Ende der bezahlten Laufzeit gültig.',
        'Cancel the subscription? Nothing will be charged any more. The token stays valid until the end of the paid period.',
      ),
    )
    if (!ok) return
    setBusy('cancel')
    setMessage(null)
    try {
      await cancelSubscription()
      setMessage(tr('Das Abonnement wurde gekündigt.', 'The subscription was cancelled.'))
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const forget = () => {
    const ok = window.confirm(
      tr(
        'Token aus diesem Browser entfernen? Es gilt weiter, aber nur wer es separat gespeichert hat, kann es wieder nutzen oder verlängern.',
        'Remove the token from this browser? It stays valid, but only someone who saved it separately can use or renew it.',
      ),
    )
    if (!ok) return
    savePaidToken(null)
    setPaid(null)
    setInfo(null)
    setFresh(false)
  }

  const expiresAt = info?.expiresAt ?? paid?.expiresAt ?? null
  const expired = expiresAt !== null && expiresAt * 1000 <= Date.now()
  const until = expiresAt ? new Date(expiresAt * 1000).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : null
  const renewOffers = paid ? offers.filter((o) => o.plan === (info?.plan ?? paid.plan)) : []

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Token kaufen', 'Buy a token')}>
        <HeaderNav route="buy" unsaved={unsaved} />
        <ThemeToggle />
      </AppHeader>

      <main className="dashboard data-page">
        <section className="dashboard-hero">
          <h1>{tr('Token kaufen', 'Buy a token')}</h1>
          <p>
            {tr(
              'Ein gekauftes Token erzeugt PDFs ohne Wasserzeichen und mit höherem Limit. Es gibt kein Benutzerkonto: Das Token ist Ihr Zugang und wird nach der Zahlung einmalig angezeigt. Die Zahlung läuft über Mollie.',
              'A purchased token creates PDFs without a watermark and with a higher limit. There is no user account: the token is your access and is shown once after payment. Payment is handled by Mollie.',
            )}
          </p>
        </section>

        {message && (
          <div className="notice" role="status" onClick={() => setMessage(null)}>
            {message}
          </div>
        )}

        {collecting !== 'idle' && (
          <section className="data-card data-card-main" role="status">
            <h2>{tr('Zahlung wird verarbeitet …', 'Processing your payment …')}</h2>
            {collecting === 'waiting' ? (
              <p>{tr('Das dauert normalerweise nur wenige Sekunden. Bitte diese Seite geöffnet lassen.', 'This usually takes only a few seconds. Please keep this page open.')}</p>
            ) : (
              <>
                <p>
                  {tr(
                    'Die Zahlung ist noch nicht bestätigt. Ist sie noch offen, kann es etwas dauern (z. B. bei Überweisung). Sie können später auf diese Seite zurückkehren.',
                    'The payment is not confirmed yet. If it is still open it can take a while (e.g. bank transfer). You can come back to this page later.',
                  )}
                </p>
                <div className="data-actions">
                  <button className="btn" onClick={() => setAttempt((n) => n + 1)}>{tr('Erneut prüfen', 'Check again')}</button>
                </div>
              </>
            )}
          </section>
        )}

        {paid && (
          <section className="data-card data-card-main">
            <h2>{fresh ? tr('Ihr neues Token', 'Your new token') : tr('Ihr Token', 'Your token')}</h2>
            {fresh && (
              <p className="data-status" data-state="warn">
                {tr(
                  'Speichern Sie dieses Token jetzt an einem sicheren Ort. Es wird nur in diesem Browser gemerkt und kann nicht wiederhergestellt werden.',
                  'Save this token somewhere safe now. It is only remembered in this browser and cannot be recovered.',
                )}
              </p>
            )}
            <p>
              {planName(info?.plan ?? paid.plan)} · {info?.limitPerMinute ?? paid.limitPerMinute} {tr('Belege pro Minute', 'documents per minute')}
              {until && ' · '}
              {until && (
                <span data-state={expired ? 'warn' : 'ok'} className="data-status">
                  {expired ? tr(`abgelaufen am ${until}`, `expired on ${until}`) : tr(`gültig bis ${until}`, `valid until ${until}`)}
                </span>
              )}
            </p>
            <p>
              {info?.subscription
                ? tr('Abonnement aktiv: Das Token verlängert sich automatisch.', 'Subscription active: the token renews automatically.')
                : tr('Kein laufendes Abonnement.', 'No running subscription.')}
            </p>
            <div className="token-row">
              <input
                className="token-value"
                readOnly
                type={shown ? 'text' : 'password'}
                value={paid.token}
                aria-label={tr('Token', 'Token')}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="btn" onClick={() => setShown((v) => !v)}>{shown ? tr('Verbergen', 'Hide') : tr('Anzeigen', 'Show')}</button>
              <button className="btn" onClick={() => void navigator.clipboard?.writeText(paid.token)}>{tr('Kopieren', 'Copy')}</button>
            </div>
            <div className="data-actions">
              {info?.subscription && (
                <button className="btn btn-danger" disabled={busy !== null} onClick={() => void cancel()}>
                  {busy === 'cancel' ? tr('Kündige …', 'Cancelling …') : tr('Abonnement kündigen', 'Cancel subscription')}
                </button>
              )}
              <button className="btn" onClick={forget}>{tr('Aus diesem Browser entfernen', 'Remove from this browser')}</button>
            </div>
            {renewOffers.length > 0 && (
              <>
                <h2 className="buy-sub">{tr('Verlängern', 'Renew')}</h2>
                <p>
                  {tr(
                    'Die Laufzeit wird nach erfolgreicher Zahlung an das bestehende Token angehängt.',
                    'After a successful payment the period is added to the existing token.',
                  )}
                </p>
                <div className="offer-grid">
                  {renewOffers.map((offer) => (
                    <OfferCard key={`r-${offer.days}`} offer={offer} currency={currency} busy={busy} label={tr('Verlängern', 'Renew')} onBuy={() => void buy(offer, paid)} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        <section className="data-card">
          <h2>{paid ? tr('Weiteres Token kaufen', 'Buy another token') : tr('Angebote', 'Offers')}</h2>
          <label className="check-row">
            <input type="checkbox" checked={subscription} onChange={(e) => setSubscription(e.target.checked)} />
            <span>
              {tr(
                'Als Abonnement: automatisch nach Ablauf erneut zahlen (jederzeit hier kündbar)',
                'As a subscription: pay again automatically when it runs out (cancel here at any time)',
              )}
            </span>
          </label>
          <div className="offer-grid">
            {offers.map((offer) => (
              <OfferCard key={`${offer.plan}:${offer.days}`} offer={offer} currency={currency} busy={busy} label={tr('Kaufen', 'Buy')} onBuy={() => void buy(offer)} />
            ))}
          </div>
          <p className="buy-note">
            {tr(
              'Sie werden zu Mollie weitergeleitet und danach hierher zurückgebracht. Auf unseren Servern werden weder Namen noch Zahlungsdaten gespeichert, nur das Token (als Prüfwert) mit Tarif und Ablaufdatum.',
              'You are sent to Mollie and brought back here afterwards. Our servers store no names or payment data, only the token (as a check value) with its plan and expiry date.',
            )}
          </p>
        </section>
      </main>
    </div>
  )
}

function OfferCard({ offer, currency, busy, label, onBuy }: { offer: Offer; currency: string; busy: string | null; label: string; onBuy: () => void }) {
  const id = `${offer.plan}:${offer.days}`
  return (
    <div className="offer-card">
      <strong>{planName(offer.plan)}</strong>
      <span>{duration(offer.days)}</span>
      <span className="offer-price">{price(offer.amount, currency)}</span>
      <span className="offer-limit">{tr(`${offer.limitPerMinute} Belege/Minute`, `${offer.limitPerMinute} documents/minute`)}</span>
      <button className="btn btn-primary" disabled={busy !== null} onClick={onBuy}>
        {busy === id ? '…' : label}
      </button>
    </div>
  )
}
