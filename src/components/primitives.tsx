import { useEffect, useRef, type ReactNode } from 'react'
import {
  AlignJustify,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleEllipsis,
  CirclePause,
  CirclePlay,
  Columns3,
  Eye,
  Grid2X2,
  List,
  ListTree,
  PackageCheck,
  Archive,
  Search,
} from 'lucide-react'
import { AGENT_LABELS, type AgentKind, type Stage } from '@/domain/types'
import type { SessionLane } from '@/domain/lanes'
import styles from './primitives.module.css'

export function CodexMark({ title = 'Codex' }: { title?: string }) {
  return <AgentMark agent="codex" title={title} />
}

/** The agent behind a session: Codex's own template asset, or a spark for Claude Code. */
export function AgentMark({ agent, title }: { agent: AgentKind; title?: string }) {
  const label = title ?? AGENT_LABELS[agent]
  if (agent === 'claude') {
    return (
      <>
        <svg className="claudeMark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 1.5c.55 0 1 .45 1 1v6.09l4.3-4.3a1 1 0 1 1 1.41 1.42L14.41 10H20.5a1 1 0 1 1 0 2h-6.09l4.3 4.3a1 1 0 0 1-1.41 1.41L13 13.41V19.5a1 1 0 1 1-2 0v-6.09l-4.3 4.3a1 1 0 0 1-1.41-1.41L9.59 12H3.5a1 1 0 1 1 0-2h6.09l-4.3-4.3A1 1 0 0 1 6.7 4.3L11 8.59V2.5c0-.55.45-1 1-1Z"
          />
        </svg>
        <span className="visuallyHidden">{label}</span>
      </>
    )
  }
  return (
    <>
      <span className="codexMark" aria-hidden="true" />
      <span className="visuallyHidden">{label}</span>
    </>
  )
}

export function Chevron({ direction = 'down' }: { direction?: 'down' | 'left' | 'right' }) {
  const Icon = direction === 'left' ? ChevronLeft : direction === 'right' ? ChevronRight : ChevronDown
  return <Icon className={styles.chevron} size={12} strokeWidth={1.7} aria-hidden="true" />
}

export function StageIcon({ stage }: { stage: Exclude<Stage, 'ideas'> }) {
  const Icon = {
    planning: CircleEllipsis,
    idle: CirclePause,
    running: CirclePlay,
    reviewing: Eye,
    'wrapping-up': PackageCheck,
    'wrapped-up': Archive,
  }[stage]

  return (
    <Icon
      className={styles.stageIcon}
      data-stage={stage}
      size={16}
      strokeWidth={1.6}
      aria-hidden="true"
    />
  )
}

export function LaneIcon({ lane }: { lane: SessionLane }) {
  if (lane === 'needs-you') {
    return (
      <CircleAlert
        className={styles.stageIcon}
        data-stage={lane}
        size={16}
        strokeWidth={1.7}
        aria-hidden="true"
      />
    )
  }
  return <StageIcon stage={lane} />
}

export function SearchIcon() {
  return <Search size={14} strokeWidth={1.7} aria-hidden="true" />
}

export function GridIcon() {
  return <Grid2X2 size={14} strokeWidth={1.7} aria-hidden="true" />
}

export function BoardIcon() {
  return <Columns3 size={14} strokeWidth={1.7} aria-hidden="true" />
}

export function TitleIcon() {
  return <AlignJustify size={14} strokeWidth={1.7} aria-hidden="true" />
}

export function DetailsIcon() {
  return <ListTree size={14} strokeWidth={1.7} aria-hidden="true" />
}

export function ListIcon() {
  return <List size={14} strokeWidth={1.7} aria-hidden="true" />
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
  variant: 'sheet' | 'palette' | 'dialog'
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
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      '[data-autofocus], input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key === 'Tab' && panelRef.current) {
        const focusableElements = [...panelRef.current.querySelectorAll<HTMLElement>(
          'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        )].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
        if (focusableElements.length === 0) {
          event.preventDefault()
          panelRef.current.focus()
          return
        }
        const first = focusableElements[0]
        const last = focusableElements.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      returnTo.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div className={styles.backdrop} data-variant={variant} onMouseDown={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        data-variant={variant}
        data-testid={testId}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
