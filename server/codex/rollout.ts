import type { Plan, PlanRevision, PlanStep, SessionActivity } from '../../src/domain/types'

export interface RolloutSnapshot {
  readonly turnId: string | null
  readonly turnStartedAt: string | null
  readonly activity: SessionActivity
  readonly hasSubstantiveActivity: boolean
  readonly endedAt: string | null
  readonly latestUserMessage: string | null
  readonly plan: Plan | null
  readonly planHistory: readonly PlanRevision[]
  readonly stageHint: 'reviewing' | 'wrapping-up' | null
  readonly pendingInputCallIds: readonly string[]
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
  let hasSubstantiveActivity = false
  let endedAt: string | null = null
  let latestUserMessage: string | null = null
  let currentStageHint: RolloutSnapshot['stageHint'] = null
  let plan: Plan | null = null
  let planHistory: PlanRevision[] = []
  const pendingInputCalls = new Set<string>()

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
      hasSubstantiveActivity = false
      endedAt = null
      latestUserMessage = null
      currentStageHint = null
      plan = null
      planHistory = []
      pendingInputCalls.clear()
      continue
    }
    if (record.type === 'event_msg' && payload?.type === 'user_message') {
      latestUserMessage = stringValue(payload.message)
      const explicit = stageHintFromMessage(latestUserMessage)
      currentStageHint = mergeStageHint(currentStageHint, explicit)
      continue
    }
    if (
      record.type === 'event_msg' &&
      (payload?.type === 'task_complete' || payload?.type === 'turn_aborted')
    ) {
      activity = 'ended'
      endedAt = timestamp
      pendingInputCalls.clear()
      continue
    }

    if (isSubstantiveAgentRecord(record)) hasSubstantiveActivity = true
    const inputCall = requestUserInputCallId(record)
    if (inputCall) {
      pendingInputCalls.add(inputCall)
      activity = 'awaiting-input'
    }
    const completedCall = functionCallOutputId(record)
    if (completedCall && pendingInputCalls.delete(completedCall) && pendingInputCalls.size === 0) {
      activity = 'working'
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
    hasSubstantiveActivity,
    endedAt,
    latestUserMessage,
    plan,
    planHistory,
    stageHint: currentStageHint,
    pendingInputCallIds: [...pendingInputCalls],
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

export function stageHintFromMessage(message: string | null): RolloutSnapshot['stageHint'] {
  if (!message) return null
  const request = requestBody(message)
  const line = request.split('\n').map((candidate) => candidate.trim()).find(Boolean) ?? ''
  const semanticLine = line.startsWith('>') ? '' : line.replace(/`[^`]*`/g, '')
  const linked = stageHintFromSkillLink(semanticLine)
  if (linked) return linked
  if (/^[\/$]wrapup(?:\s|$)/i.test(semanticLine)) return 'wrapping-up'
  if (
    /^[\/$](?:[a-z0-9]+-)*review(?:-[a-z0-9]+)*(?:\s|$)/i.test(semanticLine) ||
    /^[\/$]webapp-agent-demo(?:\s|$)/i.test(semanticLine)
  ) {
    return 'reviewing'
  }
  return null
}

function stageHintFromSkillLink(line: string): RolloutSnapshot['stageHint'] {
  const links = /\[\s*\$([a-z0-9-]+)\s*\]\(([^)\n]+)\)/gi
  for (const match of line.matchAll(links)) {
    const command = match[1]?.toLowerCase()
    const target = match[2]?.replaceAll('\\', '/').replace(/[?#].*$/, '')
    if (!command || !target || !target.toLowerCase().endsWith(`/${command}/skill.md`)) continue
    const before = line.slice(0, match.index).trim()
    const after = line.slice((match.index ?? 0) + match[0].length).trim()
    if (!/^[.!?,;:)]*$/.test(after) || linkIsDiscussedRatherThanInvoked(before)) continue
    if (command === 'wrapup') return 'wrapping-up'
    if (command === 'webapp-agent-demo' || /(?:^|-)review(?:-|$)/.test(command)) return 'reviewing'
  }
  return null
}

function linkIsDiscussedRatherThanInvoked(before: string): boolean {
  return /\b(?:do not|don't|dont)\s+(?:invoke|run|use|start)\b/i.test(before) ||
    /\b(?:not invoking|not running|not using|not starting|never invoke|never run|avoid invoking|avoid running)\b/i.test(before) ||
    /^\s*(?:why|how)\s+(?:does|is|can|could|would)\b/i.test(before) ||
    /\b(?:example|quoted?|literal|classification|misclassif(?:y|ied|ication)?|marker)\b/i.test(before)
}

function requestBody(message: string): string {
  const lines = message.split('\n')
  const marker = lines.findIndex((line) => /^## My request for Codex:\s*$/i.test(line.trim()))
  return marker === -1 ? message : lines.slice(marker + 1).join('\n')
}

function isSubstantiveAgentRecord(record: RolloutRecord): boolean {
  const payload = record.payload
  if (record.type === 'event_msg' && payload?.type === 'agent_message') return true
  if (record.type !== 'response_item') return false
  if (payload?.type === 'message') return payload.role === 'assistant'
  return payload?.type === 'custom_tool_call' ||
    payload?.type === 'custom_tool_call_output' ||
    payload?.type === 'function_call' ||
    payload?.type === 'function_call_output' ||
    payload?.type === 'web_search_call'
}

function requestUserInputCallId(record: RolloutRecord): string | null {
  const payload = record.payload
  if (
    record.type !== 'response_item' ||
    payload?.type !== 'function_call' ||
    payload.name !== 'request_user_input'
  ) {
    return null
  }
  if (typeof payload.arguments === 'string') {
    try {
      const args = JSON.parse(payload.arguments) as Record<string, unknown>
      if (typeof args.autoResolutionMs === 'number') return null
    } catch {
      // A malformed argument blob still represents a blocking native request.
    }
  }
  return stringValue(payload.call_id)
}

function functionCallOutputId(record: RolloutRecord): string | null {
  const payload = record.payload
  if (record.type !== 'response_item' || payload?.type !== 'function_call_output') return null
  return stringValue(payload.call_id)
}

function mergeStageHint(
  current: RolloutSnapshot['stageHint'],
  next: RolloutSnapshot['stageHint'],
): RolloutSnapshot['stageHint'] {
  if (!next || current === 'wrapping-up') return current
  return next
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
