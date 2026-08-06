import type { Plan, PlanRevision, PlanStep, SessionActivity } from '../../src/domain/types'

export interface RolloutSnapshot {
  readonly turnId: string | null
  readonly turnStartedAt: string | null
  readonly activity: SessionActivity
  readonly endedAt: string | null
  readonly latestUserMessage: string | null
  readonly plan: Plan | null
  readonly planHistory: readonly PlanRevision[]
  readonly stageHint: 'reviewing' | 'wrapping-up' | null
}

interface RolloutRecord {
  readonly timestamp?: string
  readonly type?: string
  readonly method?: string
  readonly params?: unknown
  readonly payload?: Record<string, unknown>
}

export function parseRolloutLines(lines: readonly string[]): RolloutSnapshot {
  let turnId: string | null = null
  let turnStartedAt: string | null = null
  let activity: SessionActivity = 'idle'
  let endedAt: string | null = null
  let latestUserMessage: string | null = null
  let plan: Plan | null = null
  let planHistory: PlanRevision[] = []

  for (const raw of lines) {
    if (!raw.trim()) continue
    let record: RolloutRecord
    try {
      record = JSON.parse(raw) as RolloutRecord
    } catch {
      continue
    }

    const timestamp = record.timestamp ?? new Date(0).toISOString()
    const payload = record.payload
    if (record.type === 'event_msg' && payload?.type === 'task_started') {
      turnId = stringValue(payload.turn_id)
      turnStartedAt = timestamp
      activity = 'working'
      endedAt = null
      latestUserMessage = null
      plan = null
      planHistory = []
      continue
    }
    if (record.type === 'event_msg' && payload?.type === 'user_message') {
      latestUserMessage = stringValue(payload.message)
      continue
    }
    if (
      record.type === 'event_msg' &&
      (payload?.type === 'task_complete' || payload?.type === 'turn_aborted')
    ) {
      activity = 'ended'
      endedAt = timestamp
      continue
    }

    const update = planUpdateFromRecord(record, timestamp, (plan?.revision ?? 0) + 1)
    if (update) {
      if (plan) planHistory.push(plan)
      plan = update
    }
  }

  return {
    turnId,
    turnStartedAt,
    activity,
    endedAt,
    latestUserMessage,
    plan,
    planHistory,
    stageHint: stageHint(latestUserMessage),
  }
}

function planUpdateFromRecord(
  record: RolloutRecord,
  timestamp: string,
  revision: number,
): Plan | null {
  if (record.method === 'turn/plan/updated' && isObject(record.params)) {
    return planFromStructured(record.params, timestamp, revision)
  }
  const payload = record.payload
  if (record.type === 'event_msg' && payload?.type === 'plan_update') {
    return planFromStructured(payload, timestamp, revision)
  }
  if (
    record.type === 'response_item' &&
    payload?.type === 'custom_tool_call' &&
    payload.name === 'exec' &&
    typeof payload.input === 'string'
  ) {
    return planFromUpdatePlanSource(payload.input, timestamp, revision)
  }
  return null
}

function planFromStructured(
  value: Record<string, unknown>,
  timestamp: string,
  revision: number,
): Plan | null {
  if (!Array.isArray(value.plan)) return null
  const steps = value.plan.flatMap((entry): PlanStep[] => {
    if (!isObject(entry) || typeof entry.step !== 'string' || typeof entry.status !== 'string') {
      return []
    }
    const status = normalisePlanStatus(entry.status)
    return status ? [{ step: entry.step, status }] : []
  })
  if (steps.length === 0) return null
  return {
    revision,
    updatedAt: timestamp,
    explanation: typeof value.explanation === 'string' ? value.explanation : null,
    steps,
  }
}

function planFromUpdatePlanSource(source: string, timestamp: string, revision: number): Plan | null {
  if (!source.includes('tools.update_plan')) return null
  const steps: PlanStep[] = []
  const item = /\{\s*["']?step["']?\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*["']?status["']?\s*:\s*"(pending|in_progress|completed)"\s*\}/g
  for (const match of source.matchAll(item)) {
    const encodedStep = match[1]
    const status = match[2] as PlanStep['status'] | undefined
    if (!encodedStep || !status) continue
    steps.push({ step: decodeDoubleQuoted(encodedStep), status })
  }
  if (steps.length === 0) return null
  const explanationMatch = source.match(/explanation\s*:\s*"((?:\\.|[^"\\])*)"/)
  return {
    revision,
    updatedAt: timestamp,
    explanation: explanationMatch?.[1] ? decodeDoubleQuoted(explanationMatch[1]) : null,
    steps,
  }
}

function decodeDoubleQuoted(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value
  }
}

function normalisePlanStatus(status: string): PlanStep['status'] | null {
  if (status === 'inProgress') return 'in_progress'
  if (status === 'pending' || status === 'in_progress' || status === 'completed') return status
  return null
}

function stageHint(message: string | null): RolloutSnapshot['stageHint'] {
  if (!message) return null
  if (/^\s*(?:\/|\$)?wrapup\b/i.test(message)) return 'wrapping-up'
  if (/^\s*(?:\/|\$)?(?:visual-review|webapp-agent-demo-review|review)\b/i.test(message)) {
    return 'reviewing'
  }
  return null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
