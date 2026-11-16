import type { AnchorHTMLAttributes } from 'react'
import type { ButtonVariant } from './Button'

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant
}

/** A link that looks like a `Button`: navigation, not an action. */
export function ButtonLink({ variant = 'filled', className = '', ...props }: Props) {
  return <a {...props} className={`ui-button ui-button-${variant}${className ? ` ${className}` : ''}`} />
}
