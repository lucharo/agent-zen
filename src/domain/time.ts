const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** A calm elapsed-time reading: `48s`, `42m`, `2h 14m`, `3h`. */
export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms)
  if (clamped < MINUTE) return `${Math.floor(clamped / SECOND)}s`
  if (clamped < HOUR) return `${Math.floor(clamped / MINUTE)}m`
  if (clamped >= WEEK) {
    const weeks = Math.floor(clamped / WEEK)
    const days = Math.floor((clamped % WEEK) / DAY)
    const hours = Math.floor((clamped % DAY) / HOUR)
    return [`${weeks}w`, days ? `${days}d` : null, hours ? `${hours}h` : null]
      .filter(Boolean)
      .join(' ')
  }
  if (clamped >= DAY) {
    const days = Math.floor(clamped / DAY)
    const hours = Math.floor((clamped % DAY) / HOUR)
    const minutes = Math.floor((clamped % HOUR) / MINUTE)
    return [`${days}d`, hours ? `${hours}h` : null, minutes ? `${minutes}m` : null]
      .filter(Boolean)
      .join(' ')
  }
  const hours = Math.floor(clamped / HOUR)
  const minutes = Math.floor((clamped % HOUR) / MINUTE)
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

export function elapsedSince(iso: string | null, now: number): number | null {
  if (!iso) return null
  const started = Date.parse(iso)
  return Number.isNaN(started) ? null : now - started
}

/**
 * The one labelled time line a Running card shows. CZ1's phrasing, kept because
 * two bare numbers side by side are ambiguous.
 */
export function formatSessionTiming(
  createdAt: string,
  turnStartedAt: string | null,
  now: number,
): string {
  const total = elapsedSince(createdAt, now)
  const turn = elapsedSince(turnStartedAt, now)
  const totalPart = total === null ? null : `${formatDuration(total)} total`
  const turnPart = turn === null ? null : `${formatDuration(turn)} current turn`
  return [totalPart, turnPart].filter(Boolean).join(' · ')
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Monday-anchored, matching how the week reads in a European working calendar. */
export function startOfWeek(now: number): number {
  const d = new Date(now)
  const day = (d.getDay() + 6) % 7
  return startOfDay(d) - day * 24 * HOUR
}

export type DateBucket =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'last-month'
  | 'older'

export const DATE_BUCKET_ORDER: readonly DateBucket[] = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'last-month',
  'older',
] as const

export const DATE_BUCKET_LABELS: Record<DateBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This week',
  'last-week': 'Last week',
  'last-month': 'Last month',
  older: 'Older',
}

export function dateBucket(iso: string, now: number): DateBucket {
  const at = Date.parse(iso)
  const todayStart = startOfDay(new Date(now))
  if (at >= todayStart) return 'today'
  if (at >= todayStart - 24 * HOUR) return 'yesterday'

  const weekStart = startOfWeek(now)
  if (at >= weekStart) return 'this-week'
  if (at >= weekStart - 7 * 24 * HOUR) return 'last-week'
  // A rolling month, so the label reads true rather than tracking calendar
  // month boundaries that put "two days ago" under "Last month".
  if (at >= now - 31 * 24 * HOUR) return 'last-month'
  return 'older'
}

/** `Today, 9:41 AM` near the present, `May 11, 3:27 PM` further back. */
export function formatCaptureTime(iso: string, now: number): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const bucket = dateBucket(iso, now)
  if (bucket === 'today') return `Today, ${time}`
  if (bucket === 'yesterday') return `Yesterday, ${time}`
  if (bucket === 'this-week' || bucket === 'last-week') {
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })}, ${time}`
  }
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}
