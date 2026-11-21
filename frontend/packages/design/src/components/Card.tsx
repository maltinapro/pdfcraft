import type { HTMLAttributes, ReactNode } from 'react'

interface Props extends HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'primary' | 'danger'
  heading?: string
  children: ReactNode
}

/** Grouped content of an app page: optional heading, tone for the main (primary) or destructive (danger) section. */
export function Card({ tone = 'default', heading, className = '', children, ...props }: Props) {
  return (
    <section {...props} className={`ui-card ui-card-${tone}${className ? ` ${className}` : ''}`}>
      {heading && <h2>{heading}</h2>}
      {children}
    </section>
  )
}
