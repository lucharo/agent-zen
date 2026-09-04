import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plan, PlanStep } from '../../src/domain/types'

/**
 * Claude Code persists its task list as `~/.claude/tasks/<sessionId>/<n>.json`.
 * That list is the Claude equivalent of the Codex `update_plan` projection: the
 * current steps and their statuses, nothing accumulated by Agent Zen.
 */
export async function readTaskPlan(directory: string): Promise<Plan | null> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return null
  }
  const files = names
    .filter((name) => /^\d+\.json$/.test(name))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
  if (files.length === 0) return null

  let updatedAt = 0
  const steps: PlanStep[] = []
  for (const name of files) {
    const path = join(directory, name)
    const [text, metadata] = await Promise.all([
      readFile(path, 'utf8').catch(() => null),
      stat(path).catch(() => null),
    ])
    if (text === null) continue
    const step = parseTaskStep(text)
    if (!step) continue
    steps.push(step)
    if (metadata && metadata.mtimeMs > updatedAt) updatedAt = metadata.mtimeMs
  }
  if (steps.length === 0) return null
  return {
    revision: 1,
    updatedAt: new Date(updatedAt || Date.now()).toISOString(),
    explanation: null,
    steps,
  }
}

export function parseTaskStep(text: string): PlanStep | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const subject = typeof record.subject === 'string' ? record.subject.trim() : ''
  const status = record.status
  if (!subject) return null
  if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return null
  return { step: subject, status }
}
