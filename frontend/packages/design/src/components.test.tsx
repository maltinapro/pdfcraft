import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppIcon, Banner, Button, Card, DocIcon, EmptyState, SegmentedButton, StatusIcon } from './index'

describe('components', () => {
  it('render the ui classes the stylesheet defines', () => {
    expect(renderToStaticMarkup(<Button variant="tonal">Go</Button>)).toContain('ui-button ui-button-tonal')
    expect(renderToStaticMarkup(<Card tone="danger" heading="H">x</Card>)).toContain('ui-card-danger')
    expect(renderToStaticMarkup(<EmptyState tone="error" title="T" />)).toContain('role="alert"')
  })

  it('names the banner close button with the given label, in English by default', () => {
    const dismiss = () => {}
    expect(renderToStaticMarkup(<Banner onDismiss={dismiss}>x</Banner>)).toContain('aria-label="Close"')
    expect(renderToStaticMarkup(<Banner onDismiss={dismiss} dismissLabel="Schließen">x</Banner>)).toContain('aria-label="Schließen"')
    expect(renderToStaticMarkup(<Banner>x</Banner>)).not.toContain('ui-banner-close')
  })

  it('marks the pressed segment', () => {
    const html = renderToStaticMarkup(
      <SegmentedButton label="L" value="b" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={() => {}} />,
    )
    expect(html).toMatch(/aria-pressed="false"[^>]*>A<.*aria-pressed="true"[^>]*>B</)
  })

  it('draw decorative icons', () => {
    for (const html of [
      renderToStaticMarkup(<AppIcon name="home" />),
      renderToStaticMarkup(<DocIcon kind="credit-note" />),
      renderToStaticMarkup(<StatusIcon status="ok" />),
    ]) {
      expect(html).toContain('aria-hidden="true"')
    }
  })
})
