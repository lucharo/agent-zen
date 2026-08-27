import type {
  Plan,
  PlanRevision,
  PlanStep,
  SessionActivity,
  SessionGoal,
  SessionGoalStatus,
  SessionCollaborationMode,
  SessionTurnOutcome,
} from '../../src/domain/types'

export interface RolloutSnapshot {
  readonly turnId: string | null
  readonly turnStartedAt: string | null
  readonly activity: SessionActivity
  readonly hasSubstantiveActivity: boolean
  readonly endedAt: string | null
  readonly latestUserMessage: string | null
  readonly plan: Plan | null
  readonly planHistory: readonly PlanRevision[]
  readonly goal: SessionGoal | null
  readonly stageHint: 'reviewing' | 'wrapping-up' | null
  readonly collaborationMode: SessionCollaborationMode | null
  readonly turnOutcome: SessionTurnOutcome | null
  readonly pendingInputCallIds: readonly string[]
}

interface RolloutRecord {
  readonly timestamp?: string
  readonly type?: string
  readonly method?: string
  readonly params?: unknown
  readonly payload?: Record<string, unknown>
}

export interface GoalRecordAnchor {
  readonly kind: 'call' | 'result'
  readonly callId: string
}

type GoalOutputSelection = 'first' | 'last' | 'only'

interface GoalToolCall {
  readonly callId: string
  readonly outputSelection: GoalOutputSelection
}

export function parseRolloutLines(lines: readonly string[]): RolloutSnapshot {
  let turnId: string | null = null
  let turnStartedAt: string | null = null
  let activity: SessionActivity = 'idle'
  let hasSubstantiveActivity = false
  let endedAt: string | null = null
  let latestUserMessage: string | null = null
  let currentStageHint: RolloutSnapshot['stageHint'] = null
  let collaborationMode: SessionCollaborationMode | null = null
  let turnOutcome: SessionTurnOutcome | null = null
  let plan: Plan | null = null
  let planHistory: PlanRevision[] = []
  let goal: SessionGoal | null = null
  const pendingInputCalls = new Set<string>()
  const goalToolCalls = new Map<string, GoalOutputSelection>()

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
      collaborationMode = null
      turnOutcome = null
      plan = null
      planHistory = []
      pendingInputCalls.clear()
      continue
    }
    collaborationMode = collaborationModeFromRecord(record) ?? collaborationMode
    const userMessage = userMessageFromRecord(record)
    if (userMessage !== null) {
      latestUserMessage = userMessage
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
      turnOutcome = payload.type === 'task_complete' ? 'completed' : 'aborted'
      pendingInputCalls.clear()
      continue
    }

    if (isSubstantiveAgentRecord(record)) hasSubstantiveActivity = true
    const goalToolCall = goalToolCallFromRecord(record)
    if (goalToolCall) goalToolCalls.set(goalToolCall.callId, goalToolCall.outputSelection)
    const goalToolOutput = goalToolOutputFromRecord(record, goalToolCalls)
    if (goalToolOutput !== undefined) goal = goalToolOutput
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
    goal,
    stageHint: currentStageHint,
    collaborationMode,
    turnOutcome,
    pendingInputCallIds: [...pendingInputCalls],
  }
}

function userMessageFromRecord(record: RolloutRecord): string | null {
  const payload = record.payload
  if (record.type === 'event_msg' && payload?.type === 'user_message') {
    return stringValue(payload.message)
  }
  if (
    record.type !== 'response_item' ||
    payload?.type !== 'message' ||
    payload.role !== 'user' ||
    !Array.isArray(payload.content)
  ) {
    return null
  }
  const text = payload.content.flatMap((item) => (
    isObject(item) && item.type === 'input_text' && typeof item.text === 'string'
      ? [item.text]
      : []
  )).join('\n')
  return text || null
}

function collaborationModeFromRecord(record: RolloutRecord): SessionCollaborationMode | null {
  const payload = record.payload
  if (!payload) return null
  const direct = isObject(payload.collaboration_mode) ? payload.collaboration_mode.mode : null
  const settings = isObject(payload.thread_settings) ? payload.thread_settings : null
  const nested = settings && isObject(settings.collaboration_mode)
    ? settings.collaboration_mode.mode
    : null
  const mode = direct ?? nested
  return mode === 'plan' || mode === 'default' ? mode : null
}

function goalToolCallFromRecord(record: RolloutRecord): GoalToolCall | null {
  const payload = record.payload
  if (
    record.type !== 'response_item' ||
    payload?.type !== 'custom_tool_call' ||
    payload.name !== 'exec' ||
    typeof payload.input !== 'string'
  ) {
    return null
  }
  const callId = stringValue(payload.call_id)
  const outputSelection = directGoalResultSelection(payload.input)
  return callId && outputSelection ? { callId, outputSelection } : null
}

function goalToolOutputFromRecord(
  record: RolloutRecord,
  goalToolCalls: ReadonlyMap<string, GoalOutputSelection>,
): SessionGoal | null | undefined {
  const payload = record.payload
  if (record.type !== 'response_item' || payload?.type !== 'custom_tool_call_output') {
    return undefined
  }
  const callId = stringValue(payload.call_id)
  const outputSelection = callId ? goalToolCalls.get(callId) : undefined
  if (!outputSelection) return undefined
  return goalPayloadFromOutput(payload.output, outputSelection)
}

function goalPayloadFromOutput(
  output: unknown,
  selection: GoalOutputSelection = 'first',
): SessionGoal | null | undefined {
  const candidates: Array<SessionGoal | null> = []
  for (const text of outputTexts(output)) {
    const parsed = parseJsonObject(text)
    if (!parsed) continue
    if (!('goal' in parsed)) continue
    if (parsed.goal === null) {
      candidates.push(null)
      continue
    }
    if (!isObject(parsed.goal)) continue
    const objective = stringValue(parsed.goal.objective)
    const status = goalStatus(parsed.goal.status)
    if (objective && status) candidates.push({ objective, status })
  }
  if (candidates.length === 0 || (selection === 'only' && candidates.length !== 1)) {
    return undefined
  }
  return selection === 'last' ? candidates[candidates.length - 1] : candidates[0]
}

export function goalRecordAnchor(line: string): GoalRecordAnchor | null {
  let record: RolloutRecord
  try {
    record = JSON.parse(line) as RolloutRecord
  } catch {
    return null
  }
  const call = goalToolCallFromRecord(record)
  if (call) return { kind: 'call', callId: call.callId }
  const payload = record.payload
  if (
    record.type !== 'response_item' ||
    payload?.type !== 'custom_tool_call_output' ||
    goalPayloadFromOutput(payload.output) === undefined
  ) {
    return null
  }
  const resultCallId = stringValue(payload.call_id)
  return resultCallId ? { kind: 'result', callId: resultCallId } : null
}

function outputTexts(output: unknown): string[] {
  if (typeof output === 'string') return [output]
  if (!Array.isArray(output)) return []
  return output.flatMap((item) => (
    isObject(item) && item.type === 'input_text' && typeof item.text === 'string'
      ? [item.text]
      : []
  ))
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value.trim()) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function goalStatus(value: unknown): SessionGoalStatus | null {
  return value === 'active' || value === 'complete' || value === 'blocked' ? value : null
}

function directGoalResultSelection(source: string): GoalOutputSelection | null {
  const code = stripJavaScriptText(source)
  const assignment = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+tools\.(?:create_goal|update_goal|get_goal)\s*\(/g
  let found: GoalOutputSelection | null = null
  for (const match of code.matchAll(assignment)) {
    const variable = match[1]
    const start = match.index ?? 0
    if (!variable) continue
    const openParen = start + match[0].lastIndexOf('(')
    const closeParen = matchingParenthesis(code, openParen)
    if (closeParen === -1) continue
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const emittedResult = `(?:${escaped}|JSON\\.stringify\\s*\\(\\s*${escaped}(?:\\s*,\\s*null\\s*,\\s*\\d+)?\\s*\\))`
    const directText = new RegExp(`^\\s*;?\\s*text\\s*\\(\\s*${emittedResult}\\s*\\)\\s*;?`)
    const directMatch = directText.exec(code.slice(closeParen + 1))
    if (!directMatch) continue
    if (found) return null
    const directStart = closeParen + 1 + (directMatch.index ?? 0)
    const directEnd = directStart + directMatch[0].length
    let hasTextBefore = false
    let hasTextAfter = false
    for (const textMatch of code.matchAll(/\btext\s*\(/g)) {
      const textPosition = textMatch.index ?? 0
      if (textPosition >= directStart && textPosition < directEnd) continue
      if (textPosition < directStart) hasTextBefore = true
      if (textPosition >= directEnd) hasTextAfter = true
    }
    found = hasTextBefore ? (hasTextAfter ? 'only' : 'last') : 'first'
  }
  return found
}

function matchingParenthesis(source: string, openParen: number): number {
  let depth = 0
  for (let index = openParen; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1
    if (source[index] === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/** Remove strings and comments so quoted examples cannot impersonate tool calls. */
function stripJavaScriptText(source: string): string {
  let result = ''
  let index = 0
  let state: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'code'
  while (index < source.length) {
    const char = source[index] ?? ''
    const next = source[index + 1] ?? ''
    if (state === 'code') {
      if (char === '/' && next === '/') {
        result += '  '
        index += 2
        state = 'line-comment'
        continue
      }
      if (char === '/' && next === '*') {
        result += '  '
        index += 2
        state = 'block-comment'
        continue
      }
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === '`') state = 'template'
      result += state === 'code' ? char : ' '
      index += 1
      continue
    }
    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code'
        result += '\n'
      } else result += ' '
      index += 1
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  '
        index += 2
        state = 'code'
      } else {
        result += char === '\n' ? '\n' : ' '
        index += 1
      }
      continue
    }
    if (char === '\\') {
      result += '  '
      index += 2
      continue
    }
    const closes = (state === 'single' && char === "'") ||
      (state === 'double' && char === '"') ||
      (state === 'template' && char === '`')
    result += char === '\n' ? '\n' : ' '
    index += 1
    if (closes) state = 'code'
  }
  return result
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
  const wrapupToken = /(?:^|[\s,;:])[\/$]wrapup(?=[\s,.!?;:]|$)/i.exec(semanticLine)
  const wrapupTokenIndex = wrapupToken
    ? wrapupToken.index + wrapupToken[0].search(/[\/$]/)
    : -1
  if (
    /^[\/$]wrapup(?:\s|$)/i.test(semanticLine) ||
    (wrapupToken &&
      !commandTokenIsQuoted(semanticLine, wrapupTokenIndex) &&
      !linkIsDiscussedRatherThanInvoked(
        semanticLine.slice(0, wrapupToken.index).trim(),
      ))
  ) {
    return 'wrapping-up'
  }
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
  return /\b(?:do not|don't|dont|not|never)\s*$/i.test(before) ||
    /\b(?:do not|don't|dont)\s+(?:invoke|run|use|start)\b/i.test(before) ||
    /\b(?:not invoking|not running|not using|not starting|never invoke|never run|avoid invoking|avoid running)\b/i.test(before) ||
    /^\s*(?:why|how)\s+(?:does|is|can|could|would)\b/i.test(before) ||
    /\b(?:example|quoted?|literal|classification|misclassif(?:y|ied|ication)?|marker|mention(?:ed|ing)?|discuss(?:ed|ing)?|reference(?:d|ing)?)\b/i.test(before)
}

function commandTokenIsQuoted(line: string, tokenIndex: number): boolean {
  let quote: "'" | '"' | null = null
  for (let index = 0; index < tokenIndex; index += 1) {
    const character = line[index]
    if (character !== "'" && character !== '"') continue
    if (index > 0 && line[index - 1] === '\\') continue
    if (
      character === "'" &&
      /[a-z0-9]/i.test(line[index - 1] ?? '') &&
      /[a-z0-9]/i.test(line[index + 1] ?? '')
    ) continue
    if (quote === character) quote = null
    else if (quote === null) quote = character
  }
  return quote !== null
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
