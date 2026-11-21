import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AppIcon } from '../icons'

interface Props {
  label: string
  children: ReactNode
}

/** Overflow menu (three dots). Closes after a choice, on Escape and when focus or a tap leaves it. */
export function Menu({ label, children }: Props) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: Event) => {
      const menu = ref.current
      if (menu?.open && !(event.target instanceof Node && menu.contains(event.target))) menu.open = false
    }
    const escape = (event: KeyboardEvent) => {
      const menu = ref.current
      if (event.key === 'Escape' && menu?.open) {
        menu.open = false
        menu.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  return (
    <details className="ui-menu" ref={ref}>
      <summary aria-label={label} title={label}><AppIcon name="overflow" /></summary>
      <div className="ui-menu-content" role="presentation" onClick={() => { if (ref.current) ref.current.open = false }}>{children}</div>
    </details>
  )
}

export function MenuItem({ danger = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return <button {...props} type="button" className={`ui-menu-item${danger ? ' ui-menu-item-danger' : ''}${className ? ` ${className}` : ''}`} />
}
