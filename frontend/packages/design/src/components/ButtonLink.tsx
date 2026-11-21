import type { AnchorHTMLAttributes } from 'react'
import type { ButtonVariant } from './Button'

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant
}

/** A link that looks like a `Button`: navigation, not an action. */
export function ButtonLink({ variant = 'filled', className = '', ...props }: Props) {
  // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the content arrives through `props.children`
  return <a {...props} className={`ui-button ui-button-${variant}${className ? ` ${className}` : ''}`} />
}
