import { useCallback, useEffect, useState } from 'react'
import { AppHeader } from './AppHeader'
import { Banner, Button, Card, EmptyState } from './ui'
import { loadPaidToken, savePaidToken, type PaidToken } from '../lib/api'
import { downloadBlob, friendlyError, tr, uiLocale, useLang } from '@pdfcraft/editor'
import {
  cancelSubscription,
  claimToken,
  fetchTokenInfo,
  loadPending,
  restoreToken,
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
  if (days >= 360 && days <= 366) return tr('Jahr (365 Tage)', 'Year (365 days)')
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
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [waiver, setWaiver] = useState(false)
  const consent = acceptTerms && waiver
  const [entered, setEntered] = useState('')

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
      // oxlint-disable-next-line no-unmodified-loop-condition -- the effect cleanup sets `cancelled`
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
          if (!cancelled) setMessage(friendlyError(e))
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
      setMessage(friendlyError(e))
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
      setMessage(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const restore = async () => {
    setBusy('restore')
    setMessage(null)
    const restored = await restoreToken(entered)
    setBusy(null)
    if (!restored) {
      setMessage(tr('Dieses Token ist unbekannt, abgelaufen oder widerrufen.', 'This token is unknown, expired or revoked.'))
      return
    }
    setEntered('')
    setFresh(false)
    setMessage(tr('Token gespeichert. Es wird jetzt in diesem Browser verwendet.', 'Token saved. It is now used in this browser.'))
    await refresh()
  }

  const download = () => {
    if (!paid) return
    const blob = new Blob([`${paid.token}\n`], { type: 'text/plain' })
    downloadBlob(blob, `pdfcraft-token-${paid.plan}.txt`)
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

  const restoreForm = (
    <>
      <p>
        {tr(
          'Haben Sie Ihr Token gespeichert (z. B. nach dem Löschen der Browserdaten), tragen Sie es hier wieder ein.',
          'If you saved your token (e.g. after browser data was deleted), enter it here again.',
        )}
      </p>
      <form
        className="token-row"
        onSubmit={(e) => {
          e.preventDefault()
          void restore()
        }}
      >
        <input
          className="token-value"
          type="password"
          autoComplete="off"
          placeholder="pk_…"
          value={entered}
          aria-label={tr('Token', 'Token')}
          onChange={(e) => setEntered(e.target.value)}
        />
        <Button variant="tonal" type="submit" disabled={busy !== null || !entered.trim()}>
          {busy === 'restore' ? '…' : tr('Token eintragen', 'Use this token')}
        </Button>
      </form>
    </>
  )

  const restoreCard = (
    <Card heading={tr('Token bereits gekauft?', 'Already bought a token?')}>
      {restoreForm}
    </Card>
  )

  const subscriptionToggle = (
    <label className="check-row">
      <input type="checkbox" checked={subscription} onChange={(e) => setSubscription(e.target.checked)} />
      <span>
        {tr(
          'Als Abonnement: automatisch nach Ablauf erneut zahlen (jederzeit hier kündbar)',
          'As a subscription: pay again automatically when it runs out (cancel here at any time)',
        )}
      </span>
    </label>
  )

  const offerCards = offers.map((offer) => (
    <OfferCard key={`${offer.plan}:${offer.days}`} offer={offer} currency={currency} busy={busy} label={tr('Zahlungspflichtig kaufen', 'Buy with obligation to pay')} disabled={!consent} onBuy={() => void buy(offer)} />
  ))

  const purchaseNote = (
    <p className="buy-note">
      {tr(
        'Mit dem Klick auf den Button geben Sie ein verbindliches Angebot ab und werden zu Mollie (europäischer Zahlungsdienstleister, Sitz in den Niederlanden) weitergeleitet, danach hierher zurückgebracht. Auf unseren Servern werden weder Namen noch Zahlungsdaten gespeichert, nur das Token (als Prüfwert) mit Tarif und Ablaufdatum. Das Token wird nicht per E-Mail zugesandt: Nach der Zahlung wird es einmalig hier angezeigt, bitte sofort sichern.',
        'Clicking the button places a binding order; you are sent to Mollie (a European payment provider based in the Netherlands) and brought back here afterwards. Our servers store no names or payment data, only the token (as a check value) with its plan and expiry date. The token is not sent by e-mail: it is shown once here after payment, so save it right away.',
      )}
    </p>
  )

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Zugang kaufen', 'Buy access')} route="buy" unsaved={unsaved} />

      <main className="page page-narrow">
        <h1>{tr('Token kaufen', 'Buy a token')}</h1>
        <p className="page-lead">
          {tr(
            'Ein gekauftes Token erzeugt PDFs ohne Wasserzeichen und mit höherem Limit. Es gibt kein Benutzerkonto: Das Token ist Ihr Zugang und wird nach der Zahlung einmalig angezeigt. Die Zahlung läuft über Mollie.',
            'A purchased token creates PDFs without a watermark and with a higher limit. There is no user account: the token is your access and is shown once after payment. Payment is handled by Mollie.',
          )}
        </p>

        {message && <Banner onDismiss={() => setMessage(null)}>{message}</Banner>}

        {collecting === 'waiting' && (
          <Card tone="primary">
            <EmptyState
              tone="loading"
              title={tr('Zahlung wird verarbeitet …', 'Processing your payment …')}
              text={tr('Das dauert normalerweise nur wenige Sekunden. Bitte diese Seite geöffnet lassen.', 'This usually takes only a few seconds. Please keep this page open.')}
            />
          </Card>
        )}
        {collecting === 'slow' && (
          <Card tone="primary">
            <EmptyState
              icon="warning"
              title={tr('Zahlung noch nicht bestätigt', 'Payment not confirmed yet')}
              text={tr(
                'Ist sie noch offen, kann es etwas dauern (z. B. bei Überweisung). Sie können später auf diese Seite zurückkehren.',
                'If it is still open it can take a while (e.g. bank transfer). You can come back to this page later.',
              )}
            >
              <Button variant="tonal" onClick={() => setAttempt((n) => n + 1)}>{tr('Erneut prüfen', 'Check again')}</Button>
            </EmptyState>
          </Card>
        )}

        <Card heading={tr('Vor dem Kauf', 'Before you buy')}>
          <p>
            {tr(
              'Preise in Euro, inklusive gesetzlicher Umsatzsteuer, soweit diese anfällt. Beide Kästchen sind für Kauf und Verlängerung nötig.',
              'Prices in euro, including statutory VAT where applicable. Both boxes are required to buy or renew.',
            )}
          </p>
          <label className="check-row">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
            <span>
              {tr('Ich habe die ', 'I have read the ')}
              <a href="/agb.html" target="_blank" rel="noreferrer">{tr('AGB', 'terms (AGB, German)')}</a>
              {tr(' und die ', ' and the ')}
              <a href="/widerruf.html" target="_blank" rel="noreferrer">{tr('Widerrufsbelehrung', 'withdrawal policy (German)')}</a>
              {tr(' gelesen und akzeptiere die AGB.', ' and accept the terms.')}
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} />
            <span>
              {tr(
                'Ich verlange ausdrücklich, dass die Leistung sofort nach dem Kauf beginnt. Mir ist bekannt, dass ich mein Widerrufsrecht bei vollständiger Vertragserfüllung verliere und bei einem Widerruf vor vollständiger Erfüllung Wertersatz für die bereits erbrachte Leistung zahle (nur für Verbraucher).',
                'I expressly request that the service starts immediately after purchase. I know that I lose my right of withdrawal once the contract is fully performed, and that I pay compensation for the service already provided if I withdraw before (consumers only).',
              )}
            </span>
          </label>
        </Card>

        {paid && (
          <Card tone="primary" heading={fresh ? tr('Ihr neues Token', 'Your new token') : tr('Ihr Token', 'Your token')}>
            {fresh && (
              <p className="data-status" data-state="warn">
                {tr(
                  'Speichern Sie dieses Token jetzt an einem sicheren Ort (kopieren oder „Als Datei speichern“). Es wird nur in diesem Browser gemerkt und kann nicht wiederhergestellt werden.',
                  'Save this token somewhere safe now (copy it or use “Save as file”). It is only remembered in this browser and cannot be recovered.',
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
              <Button variant="tonal" onClick={() => setShown((v) => !v)}>{shown ? tr('Verbergen', 'Hide') : tr('Anzeigen', 'Show')}</Button>
              <Button variant="tonal" onClick={() => void navigator.clipboard?.writeText(paid.token)}>{tr('Kopieren', 'Copy')}</Button>
              <Button variant="tonal" onClick={download}>{tr('Als Datei speichern', 'Save as file')}</Button>
            </div>
            <div className="card-actions">
              {info?.subscription && (
                <Button variant="danger" disabled={busy !== null} onClick={() => void cancel()}>
                  {busy === 'cancel' ? tr('Kündige …', 'Cancelling …') : tr('Abonnement kündigen', 'Cancel subscription')}
                </Button>
              )}
              <Button variant="text" onClick={forget}>{tr('Aus diesem Browser entfernen', 'Remove from this browser')}</Button>
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
                {!info?.subscription && subscriptionToggle}
                <div className="offer-grid">
                  {renewOffers.map((offer) => (
                    <OfferCard key={`r-${offer.days}`} offer={offer} currency={currency} busy={busy} label={tr('Zahlungspflichtig verlängern', 'Renew with obligation to pay')} disabled={!consent} onBuy={() => void buy(offer, paid)} />
                  ))}
                </div>
                {purchaseNote}
              </>
            )}
          </Card>
        )}


        {!paid ? (
          <Card heading={tr('Angebote', 'Offers')}>
            {subscriptionToggle}
            <div className="offer-grid">{offerCards}</div>
            {purchaseNote}
          </Card>
        ) : (
          <details className="ui-card ui-card-default other-token">
            <summary>{tr('Anderen Tarif oder neues Token kaufen', 'Buy another plan or a new token')}</summary>
            <p>
              {tr(
                'Achtung: Ein neu gekauftes Token ersetzt das in diesem Browser gespeicherte. Das bisherige bleibt gültig, wenn Sie es gesichert haben.',
                'Note: a newly bought token replaces the one stored in this browser. The current one stays valid if you saved it.',
              )}
            </p>
            {subscriptionToggle}
            <div className="offer-grid">{offerCards}</div>
            {purchaseNote}
            {restoreForm}
          </details>
        )}
        {!paid && restoreCard}
      </main>
    </div>
  )
}

function OfferCard({ offer, currency, busy, label, disabled, onBuy }: { offer: Offer; currency: string; busy: string | null; label: string; disabled: boolean; onBuy: () => void }) {
  const id = `${offer.plan}:${offer.days}`
  return (
    <div className="offer-card">
      <strong>{planName(offer.plan)}</strong>
      <span>{duration(offer.days)}</span>
      <span className="offer-price">{price(offer.amount, currency)}</span>
      <span className="offer-limit">{tr(`${offer.limitPerMinute} Belege/Minute`, `${offer.limitPerMinute} documents/minute`)}</span>
      <Button disabled={disabled || busy !== null} onClick={onBuy}>
        {busy === id ? '…' : label}
      </Button>
    </div>
  )
}
