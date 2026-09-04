import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '../../src/domain/types'
import { classifySession } from '../../src/domain/stage'
import { ClaudeBackend } from './claudeBackend'
import { parseRegistryEntry, readLiveRegistry } from './registry'
import { parseTaskStep, readTaskPlan } from './tasks'
import {
  applyTranscriptRecord,
  EMPTY_TRANSCRIPT,
  ClaudeTranscriptReader,
  plainPromptText,
  stageHintFromClaudePrompt,
} from './transcript'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const project: Project = {
  id: 'project',
  name: 'agent-zen',
  directory: '/repo',
  repository: 'lucharo/agent-zen',
}

function registryEntry(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid: 4242,
    sessionId: 'session-a',
    cwd: '/repo/.claude/worktrees/feature',
    startedAt: 1_788_449_285_638,
    version: '2.1.259',
    kind: 'interactive',
    entrypoint: 'cli',
    name: 'agent-zen-ef',
    nameSource: 'derived',
    status: 'busy',
    updatedAt: 1_788_477_420_245,
    statusUpdatedAt: 1_788_477_420_245,
    ...overrides,
  })
}

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record)
}

function humanPrompt(text: string, overrides: Record<string, unknown> = {}): string {
  return line({
    type: 'user',
    uuid: overrides.uuid ?? 'prompt-1',
    timestamp: overrides.timestamp ?? '2026-09-04T00:10:00.000Z',
    sessionId: 'session-a',
    cwd: '/repo',
    gitBranch: 'feature',
    version: '2.1.259',
    promptSource: 'typed',
    message: { role: 'user', content: text },
    ...overrides,
  })
}

function nativeCommand(command: string, args = ''): string {
  return `<command-name>${command}</command-name>\n<command-message>${command.slice(1)}</command-message>\n<command-args>${args}</command-args>`
}

async function claudeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'agent-zen-claude-'))
  cleanup.push(home)
  await mkdir(join(home, 'sessions'), { recursive: true })
  await mkdir(join(home, 'projects', '-repo'), { recursive: true })
  await mkdir(join(home, 'tasks'), { recursive: true })
  return home
}

describe('registry', () => {
  test('parses the stock registry file and rejects malformed ones', () => {
    expect(parseRegistryEntry(registryEntry({ status: 'waiting', waitingFor: 'dialog open' }))).toEqual({
      pid: 4242,
      sessionId: 'session-a',
      cwd: '/repo/.claude/worktrees/feature',
      startedAt: 1_788_449_285_638,
      version: '2.1.259',
      kind: 'interactive',
      entrypoint: 'cli',
      name: 'agent-zen-ef',
      nameSource: 'derived',
      status: 'waiting',
      waitingFor: 'dialog open',
      statusUpdatedAt: 1_788_477_420_245,
    })
    expect(parseRegistryEntry('not json')).toBeNull()
    expect(parseRegistryEntry(registryEntry({ status: 'confused' }))).toBeNull()
    expect(parseRegistryEntry(registryEntry({ sessionId: '' }))).toBeNull()
  })

  test('keeps live interactive sessions only and reports a missing directory as null', async () => {
    const home = await claudeHome()
    const directory = join(home, 'sessions')
    await writeFile(join(directory, '1.json'), registryEntry({ pid: 1, sessionId: 'busy' }))
    await writeFile(join(directory, '2.json'), registryEntry({ pid: 2, sessionId: 'dead' }))
    await writeFile(join(directory, '3.json'), registryEntry({ pid: 3, sessionId: 'exited', status: 'exited' }))
    await writeFile(join(directory, '4.json'), registryEntry({ pid: 4, sessionId: 'headless', kind: 'sdk' }))
    await writeFile(join(directory, '5.json'), registryEntry({ pid: 5, sessionId: 'idle', status: 'idle' }))
    await writeFile(join(directory, '5.abc.key'), '{"secret":"never read"}')
    await writeFile(join(directory, '6.json'), '{')

    const live = await readLiveRegistry({
      directory,
      isProcessAlive: (pid) => pid !== 2,
      processName: async (pid) => pid === 5 ? 'python3' : 'claude',
    })
    expect(live?.entries.map((entry) => entry.sessionId).sort()).toEqual(['busy'])
    expect(live?.processRejections).toEqual([
      { pid: 5, sessionId: 'idle', command: 'python3' },
    ])
    expect(await readLiveRegistry({ directory: join(home, 'nope'), isProcessAlive: () => true })).toBeNull()
  })
})

describe('tasks', () => {
  test('maps the task directory to a plan in id order and ignores junk', async () => {
    const home = await claudeHome()
    const directory = join(home, 'tasks', 'session-a')
    await mkdir(directory)
    await writeFile(join(directory, '10.json'), JSON.stringify({ id: '10', subject: 'Ship it', status: 'pending' }))
    await writeFile(join(directory, '2.json'), JSON.stringify({ id: '2', subject: 'Build', status: 'in_progress', activeForm: 'Building' }))
    await writeFile(join(directory, '1.json'), JSON.stringify({ id: '1', subject: 'Plan', status: 'completed' }))
    await writeFile(join(directory, '3.json'), JSON.stringify({ id: '3', subject: 'Odd', status: 'blocked' }))
    await writeFile(join(directory, '.lock'), '')

    const plan = await readTaskPlan(directory)
    expect(plan?.steps).toEqual([
      { step: 'Plan', status: 'completed' },
      { step: 'Build', status: 'in_progress' },
      { step: 'Ship it', status: 'pending' },
    ])
    expect(plan?.revision).toBe(1)
    expect(await readTaskPlan(join(home, 'tasks', 'missing'))).toBeNull()
    expect(parseTaskStep('{"subject":"  ","status":"pending"}')).toBeNull()
  })
})

describe('transcript', () => {
  test('folds human prompts, assistant output, mode and titles; ignores tool results and injected context', () => {
    let snapshot = EMPTY_TRANSCRIPT
    const fold = (record: string) => { snapshot = applyTranscriptRecord(snapshot, record) }
    fold(humanPrompt('Fix the flaky test', { uuid: 'p1', timestamp: '2026-09-04T00:00:00.000Z' }))
    fold(line({ type: 'ai-title', aiTitle: 'Flaky test fix' }))
    fold(line({ type: 'permission-mode', permissionMode: 'plan' }))
    fold(line({ type: 'assistant', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'On it' }] } }))
    expect(snapshot.hasSubstantiveActivity).toBe(true)
    expect(snapshot.collaborationMode).toBe('plan')

    fold(humanPrompt('Injected continuation prompt', { uuid: 'meta', isMeta: true }))
    fold(humanPrompt('<system-reminder>only a reminder</system-reminder>', { uuid: 'reminder' }))
    fold(line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] }, toolUseResult: 'ok', sourceToolUseID: 'x' }))
    expect(snapshot.turnId).toBe('p1')

    fold(line({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [] }, isApiErrorMessage: true }))
    fold(humanPrompt(nativeCommand('/wrapup', 'quickly'), { uuid: 'p2', timestamp: '2026-09-04T00:20:00.000Z' }))
    fold(line({ type: 'permission-mode', permissionMode: 'bypassPermissions' }))
    fold(line({ type: 'custom-title', customTitle: 'Renamed by hand' }))

    expect(snapshot).toEqual({
      turnId: 'p2',
      turnStartedAt: '2026-09-04T00:20:00.000Z',
      hasSubstantiveActivity: false,
      collaborationMode: 'default',
      customTitle: 'Renamed by hand',
      aiTitle: 'Flaky test fix',
      firstPrompt: 'Fix the flaky test',
      latestPrompt: '/wrapup quickly',
      model: 'claude-fable-5-1',
      cliVersion: '2.1.259',
      branch: 'feature',
      stageHint: 'wrapping-up',
    })
  })

  test('reads a workflow stage from tagged and typed slash commands only', () => {
    const nativeWrapup = nativeCommand('/wrapup')
    expect(stageHintFromClaudePrompt('/wrapup')).toBe('wrapping-up')
    expect(stageHintFromClaudePrompt('/code-review high')).toBe('reviewing')
    expect(stageHintFromClaudePrompt('/webapp-agent-demo')).toBe('reviewing')
    expect(stageHintFromClaudePrompt('/dev:review')).toBe('reviewing')
    expect(stageHintFromClaudePrompt('/model')).toBeNull()
    expect(stageHintFromClaudePrompt('please do not run /wrapup yet')).toBeNull()
    expect(stageHintFromClaudePrompt('$wrapup\nland it')).toBe('wrapping-up')
    expect(stageHintFromClaudePrompt(plainPromptText(nativeWrapup))).toBe('wrapping-up')
    expect(stageHintFromClaudePrompt(plainPromptText('<command-name>/wrapup</command-name>'))).toBeNull()
    expect(stageHintFromClaudePrompt(plainPromptText(`Example only:\n${nativeWrapup}`))).toBeNull()
    expect(stageHintFromClaudePrompt('review this reasoning with me')).toBeNull()
  })

  test('parses appended bytes only, including a partial trailing line', async () => {
    const home = await claudeHome()
    const path = join(home, 'projects', '-repo', 'session-a.jsonl')
    await writeFile(path, humanPrompt('First', { uuid: 'p1' }) + '\n')
    const reader = new ClaudeTranscriptReader()
    expect((await reader.read(path)).turnId).toBe('p1')

    const second = humanPrompt('Second', { uuid: 'p2', timestamp: '2026-09-04T01:00:00.000Z' })
    await appendFile(path, second.slice(0, 20))
    expect((await reader.read(path)).turnId).toBe('p1')
    await appendFile(path, second.slice(20) + '\n')
    const snapshot = await reader.read(path)
    expect(snapshot.turnId).toBe('p2')
    expect(snapshot.firstPrompt).toBe('First')
    expect(snapshot.latestPrompt).toBe('Second')
  })

  test('preserves a multibyte prompt split across read chunks', async () => {
    const home = await claudeHome()
    const path = join(home, 'projects', '-repo', 'session-a.jsonl')
    const marker = 'SPLIT-HERE'
    const template = humanPrompt(marker, { uuid: 'unicode' })
    const markerOffset = Buffer.from(template).indexOf(marker)
    const padding = 'x'.repeat((1024 * 1024) - 1 - markerOffset)
    await writeFile(path, template.replace(marker, `${padding}🙂 boundary`) + '\n')

    const snapshot = await new ClaudeTranscriptReader().read(path)

    expect(snapshot.turnId).toBe('unicode')
    expect(snapshot.latestPrompt?.endsWith('🙂 boundary')).toBe(true)
  })

  test('skips an oversized record and resumes at the next complete line', async () => {
    const home = await claudeHome()
    const path = join(home, 'projects', '-repo', 'session-a.jsonl')
    const oversizedPrompt = humanPrompt('x'.repeat(2048), { uuid: 'too-large' })
    await writeFile(path, oversizedPrompt)
    const reader = new ClaudeTranscriptReader({ maxRecordBytes: 1024 })

    expect((await reader.read(path)).turnId).toBeNull()

    await appendFile(path, `\n${humanPrompt('After the large result', { uuid: 'after-large' })}\n`)

    const snapshot = await reader.read(path)

    expect(snapshot.turnId).toBe('after-large')
    expect(snapshot.firstPrompt).toBe('After the large result')
    expect(snapshot.latestPrompt).toBe('After the large result')
  })
})

describe('ClaudeBackend', () => {
  test('composes read-only sessions with parity fields and classifies them like Codex', async () => {
    const home = await claudeHome()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry())
    await writeFile(join(home, 'sessions', '4243.json'), registryEntry({
      pid: 4243,
      sessionId: 'session-b',
      cwd: '/elsewhere',
      status: 'waiting',
      waitingFor: 'dialog open',
      name: 'elsewhere-ab',
    }))
    await writeFile(join(home, 'sessions', '4244.json'), registryEntry({
      pid: 4244,
      sessionId: 'session-c',
      status: 'idle',
    }))
    await writeFile(
      join(home, 'projects', '-repo', 'session-a.jsonl'),
      [
        humanPrompt('Add the Claude backend', { uuid: 'p1' }),
        line({ type: 'ai-title', aiTitle: 'Claude backend' }),
        line({ type: 'assistant', message: { role: 'assistant', model: 'claude-fable-5-1', content: [] } }),
      ].join('\n') + '\n',
    )
    await writeFile(
      join(home, 'projects', '-repo', 'session-c.jsonl'),
      [
        humanPrompt(nativeCommand('/wrapup'), { uuid: 'p9' }),
        line({ type: 'assistant', message: { role: 'assistant', model: 'claude-fable-5-1', content: [] } }),
      ].join('\n') + '\n',
    )
    await mkdir(join(home, 'tasks', 'session-a'))
    await writeFile(join(home, 'tasks', 'session-a', '1.json'), JSON.stringify({ id: '1', subject: 'Write it', status: 'in_progress' }))
    await mkdir(join(home, 'tasks', 'session-session-'))
    await writeFile(join(home, 'tasks', 'session-session-', '1.json'), JSON.stringify({ id: '1', subject: 'Short-key task', status: 'pending' }))

    const origins: string[] = []
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [project],
      isProcessAlive: () => true,
      processName: () => 'claude',
      gitOriginUrl: async (directory) => {
        origins.push(directory)
        return directory.startsWith('/repo') ? 'git@github.com:lucharo/agent-zen.git' : null
      },
    })
    await backend.start()
    expect(backend.status()).toEqual({
      agent: 'claude',
      connected: true,
      label: 'Claude Code · local observer',
      userAgent: 'Claude Code 2.1.259',
      error: null,
    })

    const sessions = await backend.observe()
    const byId = new Map(sessions.map((session) => [session.id, session]))
    const busy = byId.get('session-a')!
    expect(busy).toMatchObject({
      agent: 'claude',
      source: 'external',
      title: 'Claude backend',
      model: 'claude-fable-5-1',
      cliVersion: '2.1.259',
      activity: 'working',
      turnId: 'p1',
      turnStartedAt: '2026-09-04T00:10:00.000Z',
      hasSubstantiveActivity: true,
      cwd: '/repo/.claude/worktrees/feature',
      repository: 'lucharo/agent-zen',
      branch: 'feature',
      projectId: project.id,
      endedAt: null,
      pendingRequest: null,
    })
    expect(busy.plan?.steps).toEqual([{ step: 'Write it', status: 'in_progress' }])
    expect(classifySession(busy)).toEqual({ stage: 'running', reason: 'active-turn', needsUser: false })

    const waiting = byId.get('session-b')!
    expect(waiting.activity).toBe('awaiting-input')
    expect(waiting.title).toBe('elsewhere-ab')
    expect(waiting.projectId).toBeNull()
    expect(waiting.pendingRequest).toEqual({
      kind: 'unsupported',
      requestId: 1_788_477_420_245,
      title: 'Claude Code needs you in its terminal',
      detail: 'dialog open',
    })
    expect(classifySession(waiting).needsUser).toBe(true)

    const idle = byId.get('session-c')!
    expect(idle.plan?.steps).toEqual([{ step: 'Short-key task', status: 'pending' }])
    expect(idle.activity).toBe('idle')
    expect(idle.turnOutcome).toBe('completed')
    expect(idle.wrapup).toEqual({ checksPassed: null, checksTotal: null })
    expect(classifySession(idle).stage).toBe('wrapped-up')

    await backend.observe()
    expect(origins.sort()).toEqual(['/elsewhere', '/repo/.claude/worktrees/feature'])
  })

  test('reports a missing registry as disconnected with no sessions', async () => {
    const backend = new ClaudeBackend({
      claudeHome: join(tmpdir(), 'agent-zen-no-claude-here'),
      getProjects: () => [],
      isProcessAlive: () => true,
      processName: () => 'claude',
      gitOriginUrl: async () => null,
    })
    expect(await backend.observe()).toEqual([])
    expect(backend.status().connected).toBe(false)
    expect(backend.status().error).toContain('sessions')
  })

  test('does not complete a wrapup turn when Claude only records an API error', async () => {
    const home = await claudeHome()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry({ status: 'idle' }))
    await writeFile(
      join(home, 'projects', '-repo', 'session-a.jsonl'),
      [
        humanPrompt(nativeCommand('/wrapup'), { uuid: 'wrapup-turn' }),
        line({
          type: 'assistant',
          isApiErrorMessage: true,
          message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'API error' }] },
        }),
      ].join('\n') + '\n',
    )
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [project],
      isProcessAlive: () => true,
      processName: () => 'claude',
      gitOriginUrl: async () => 'git@github.com:lucharo/agent-zen.git',
    })

    const [session] = await backend.observe()

    expect(session?.hasSubstantiveActivity).toBe(false)
    expect(session?.turnOutcome).toBeNull()
    expect(session && classifySession(session).stage).toBe('idle')
  })

  test('reports process identity rejection instead of looking like no sessions exist', async () => {
    const home = await claudeHome()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry())
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [],
      isProcessAlive: () => true,
      processName: async () => 'node',
      gitOriginUrl: async () => null,
    })

    expect(await backend.observe()).toEqual([])
    expect(backend.status()).toMatchObject({
      connected: false,
      label: 'Claude Code sessions rejected',
      error: expect.stringContaining('process identity'),
    })
  })

  test('keeps registry-confirmed Claude sessions when one transcript fails', async () => {
    const home = await claudeHome()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry())
    await writeFile(join(home, 'sessions', '4243.json'), registryEntry({ pid: 4243, sessionId: 'session-b' }))
    await writeFile(join(home, 'projects', '-repo', 'session-a.jsonl'), humanPrompt('Broken') + '\n')
    await writeFile(join(home, 'projects', '-repo', 'session-b.jsonl'), humanPrompt('Readable', { uuid: 'p2' }) + '\n')
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [project],
      isProcessAlive: () => true,
      processName: async () => 'claude',
      gitOriginUrl: async () => null,
      transcriptReader: {
        read: async (path) => {
          if (path.endsWith('session-a.jsonl')) throw new Error('transcript unreadable')
          return new ClaudeTranscriptReader().read(path)
        },
      },
    })

    const sessions = await backend.observe()
    expect(sessions.map((session) => session.id).sort()).toEqual(['session-a', 'session-b'])
    expect(sessions.find((session) => session.id === 'session-a')).toMatchObject({
      activity: 'working',
      title: 'agent-zen-ef',
      turnId: null,
    })
    expect(classifySession(sessions.find((session) => session.id === 'session-a')!).stage).toBe('running')
    expect(backend.status()).toMatchObject({
      connected: true,
      error: expect.stringContaining('1 Claude Code session could not be read'),
    })
  })
})
