import { useEffect, useRef, type ReactNode } from 'react'
import styles from './primitives.module.css'

export function CodexMark({ title = 'Codex' }: { title?: string }) {
  return (
    <>
      <span className="codexMark" aria-hidden="true" />
      <span className="visuallyHidden">{title}</span>
    </>
  )
}

export function Chevron({ direction = 'down' }: { direction?: 'down' | 'right' }) {
  return (
    <svg
      className={styles.chevron}
      data-direction={direction}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <path
        d="M3 4.5 6 7.5 9 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <circle cx="6" cy="6" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.2 9.2 12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function GridIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {[0, 8].flatMap((y) =>
        [0, 8].map((x) => (
          <rect
            key={`${x}-${y}`}
            x={x + 0.5}
            y={y + 0.5}
            width="5"
            height="5"
            rx="1.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        )),
      )}
    </svg>
  )
}

export function ListIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {[2.5, 7, 11.5].map((y) => (
        <path
          key={y}
          d={`M1 ${y}h12`}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

export interface SelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  /** Rendered before the value, e.g. `Group by:`. */
  prefix?: string
  hint?: string
  id?: string
  /** Fill the container instead of hugging the value. */
  block?: boolean
}

/**
 * A native `<select>` in quiet clothing. Native gives us the macOS menu, full
 * keyboard behaviour and screen-reader support for free; only the chrome is
 * ours.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  prefix,
  hint,
  id,
  block,
}: SelectProps) {
  const current = options.find((o) => o.value === value)
  return (
    <div className={styles.select} data-block={block ? 'true' : undefined}>
      <span className={styles.selectFace}>
        {prefix ? <span className={styles.selectPrefix}>{prefix}</span> : null}
        <span className={styles.selectValue}>{current?.label ?? value}</span>
        {hint ? <span className={styles.selectHint}>{hint}</span> : null}
        <Chevron />
      </span>
      <select
        id={id}
        className={styles.selectInput}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export interface OverlayProps {
  open: boolean
  onClose: () => void
  labelledBy: string
  children: ReactNode
  variant: 'sheet' | 'palette'
  testId?: string
}

/**
 * Modal surface with Escape, backdrop dismissal, initial focus and focus
 * return. Every layered surface in the app goes through this so the keyboard
 * contract is written once.
 */
export function Overlay({ open, onClose, labelledBy, children, variant, testId }: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement as HTMLElement | null
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input, textarea, [data-autofocus], button, [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnTo.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.backdrop} data-variant={variant} onMouseDown={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        data-variant={variant}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
