import type { HTMLAttributes, ReactNode } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'warning' | 'error' | 'success'
  children: ReactNode
}

export function Banner({ tone = 'info', className = '', children, ...props }: Props) {
  return <div {...props} className={`ui-banner ui-banner-${tone}${className ? ` ${className}` : ''}`} role={props.role ?? (tone === 'error' ? 'alert' : 'status')}>{children}</div>
}
