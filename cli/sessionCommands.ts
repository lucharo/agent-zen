import type { BridgeSnapshot } from '../src/bridge/types'
import { planProgress, stageReasonLabel, type ClassifiedAgentSession } from '../src/domain/stage'
import {
  AGENT_LABELS, STAGE_LABELS
} from '../src/domain/types'

export interface SessionCommandIo {
  readonly snapshot: () => Promise<BridgeSnapshot>
  readonly write: (value: string) => void
}

export async function runSessionsCommand(
  args: readonly string[],
  io: SessionCommandIo,
): Promise<void> {
  requireJsonOnly('sessions', args)
  const snapshot = await io.snapshot()
  const sessions = snapshot.sessions.filter((session) => !session.parentSessionId)
  if (args.includes('--json')) {
    io.write(JSON.stringify({
      generatedAt: snapshot.generatedAt,
      protocolVersion: snapshot.protocolVersion,
      sessions: sessions.map(sessionListItem),
    }, null, 2))
    return
  }
  if (sessions.length === 0) {
    io.write('No live agent sessions.')
    return
  }
  io.write(sessions.map((session) => [
    stageLabel(session),
    attentionLabel(session),
    goalLabel(session),
    AGENT_LABELS[session.agent],
    session.title,
    session.id,
  ].join('\t')).join('\n'))
}

export async function runExplainCommand(
  args: readonly string[],
  io: SessionCommandIo,
): Promise<void> {
  const json = args.includes('--json')
  const query = args.filter((argument) => argument !== '--json')
  if (query.length !== 1 || args.some((argument) => argument.startsWith('-') && argument !== '--json')) {
    throw new Error('Usage: agent-zen explain <session-id-or-title-prefix> [--json]')
  }
  const snapshot = await io.snapshot()
  const session = resolveSession(snapshot.sessions, query[0] ?? '')
  const value = sessionExplanation(snapshot, session)
  if (json) {
    io.write(JSON.stringify(value, null, 2))
    return
  }
  io.write([
    `Session: ${session.title}`,
    `ID: ${session.id}`,
    `Stage: ${stageLabel(session)}`,
    `Reason: ${stageReasonLabel(session.classification.reason)} (${session.classification.reason})`,
    `Attention: ${attentionLabel(session)}`,
    `Goal: ${goalLabel(session)}${session.goal ? ` · ${session.goal.objective}` : ''}`,
    `Project: ${session.projectId ?? 'Outside a Git project'}`,
    `Turn: ${session.turnId ?? 'none'}`,
    `Snapshot: ${snapshot.generatedAt} · protocol ${snapshot.protocolVersion}`,
  ].join('\n'))
}

function resolveSession(
  sessions: readonly ClassifiedAgentSession[],
  query: string,
): ClassifiedAgentSession {
  const exact = sessions.find((session) => session.id === query || session.threadId === query)
  if (exact) return exact
  const normalised = query.toLocaleLowerCase()
  const matches = sessions.filter((session) => session.title.toLocaleLowerCase().startsWith(normalised))
  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) throw new Error(`No live session matches: ${query}`)
  throw new Error(`Session prefix ${JSON.stringify(query)} matches ${matches.length} sessions; use an id.`)
}

function sessionListItem(session: ClassifiedAgentSession) {
  return {
    id: session.id,
    agent: session.agent,
    title: session.title,
    projectId: session.projectId,
    activity: session.activity,
    stage: session.classification.stage,
    reason: session.classification.reason,
    needsUser: session.classification.needsUser,
    goal: session.goal,
  }
}

function sessionExplanation(snapshot: BridgeSnapshot, session: ClassifiedAgentSession) {
  return {
    generatedAt: snapshot.generatedAt,
    protocolVersion: snapshot.protocolVersion,
    session: {
      id: session.id,
      agent: session.agent,
      threadId: session.threadId,
      title: session.title,
      projectId: session.projectId,
      cwd: session.cwd,
      parentSessionId: session.parentSessionId,
      activity: session.activity,
      stage: session.classification.stage,
      reason: session.classification.reason,
      needsUser: session.classification.needsUser,
      turnId: session.turnId,
      plan: planProgress(session),
      goal: session.goal,
    },
  }
}

function stageLabel(session: ClassifiedAgentSession): string {
  const stage = session.classification.stage
  return stage ? STAGE_LABELS[stage] : 'Finished'
}

function attentionLabel(session: ClassifiedAgentSession): string {
  if (session.classification.needsUser) return 'Needs you'
  if (session.activity === 'working') return 'Working'
  if (session.activity === 'idle') return 'Idle'
  return 'Ended'
}

function goalLabel(session: ClassifiedAgentSession): string {
  if (!session.goal) return 'No goal'
  return `Goal ${session.goal.status}`
}

function requireJsonOnly(command: string, args: readonly string[]): void {
  const unknown = args.find((argument) => argument !== '--json')
  if (unknown) throw new Error(`Unknown ${command} option: ${unknown}`)
}
