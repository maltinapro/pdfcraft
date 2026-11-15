import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'filled' | 'tonal' | 'text' | 'icon' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: ReactNode
  label?: string
}

export function Button({ variant = 'filled', icon, label, children, className = '', ...props }: Props) {
  return (
    <button
      {...props}
      className={`ui-button ui-button-${variant}${className ? ` ${className}` : ''}`}
      aria-label={label ?? props['aria-label']}
      title={variant === 'icon' ? label ?? props.title : props.title}
    >
      {icon}
      {children}
    </button>
  )
}
