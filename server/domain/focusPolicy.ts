import { activeSessionCount, deriveStage, launchAvailability } from '../../src/domain/stage'
import type { AgentSession } from '../../src/domain/types'

export interface FocusSettings {
  readonly enabled: boolean
  readonly limit: number
}

export interface LaunchRequest {
  readonly cwd: string
  readonly prompt: string
  readonly model?: string | null
  readonly effort?: string | null
}

export interface LaunchResult {
  readonly threadId: string
  readonly turnId: string
}

export interface LaunchCoordinatorDependencies {
  readonly getSessions: () => readonly AgentSession[] | Promise<readonly AgentSession[]>
  readonly getFocus: () => FocusSettings | Promise<FocusSettings>
  readonly launch: (request: LaunchRequest) => Promise<LaunchResult>
}

export class FocusLimitReachedError extends Error {
  constructor(
    readonly active: number,
    readonly limit: number,
  ) {
    super(`Focus limit reached: ${active} of ${limit} root-session slots are occupied.`)
    this.name = 'FocusLimitReachedError'
  }
}

/**
 * The only launch seam in Agent Zen.
 *
 * The queue is load-bearing: two clicks arriving together must not both observe
 * the same final free slot. Existing agent work is never interrupted here.
 */
export class LaunchCoordinator {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: LaunchCoordinatorDependencies) {}

  launch(request: LaunchRequest): Promise<LaunchResult> {
    const result = this.queue.then(async () => {
      const [sessions, focus] = await Promise.all([
        this.dependencies.getSessions(),
        this.dependencies.getFocus(),
      ])
      const active = activeSessionCount(sessions, deriveStage)
      const availability = launchAvailability(active, focus.enabled, focus.limit)
      if (!availability.allowed) throw new FocusLimitReachedError(active, focus.limit)
      return this.dependencies.launch(request)
    })

    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
