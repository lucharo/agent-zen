import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '../../src/domain/types'
import { classifySession } from '../../src/domain/stage'
import { ClaudeBackend } from './claudeBackend'
import { parseRegistryEntry, readLiveRegistry, runningProcesses } from './registry'
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

function assistantToolUse(
  name: string,
  id: string,
  input: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): string {
  return line({
    type: 'assistant',
    message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] },
    ...overrides,
  })
}

function toolResult(toolUseId: string, toolUseResult: Record<string, unknown>, timestamp: string): string {
  return line({
    type: 'user',
    timestamp,
    sourceToolUseID: toolUseId,
    toolUseResult,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] },
  })
}

/** A skill or prompt command as Claude Code records it: `<command-message>` first. */
function skillCommand(command: string, args = ''): string {
  return `<command-message>${command.slice(1)}</command-message>\n<command-name>${command}</command-name>\n<command-args>${args}</command-args>`
}

/** A built-in local command (`/model`, `/effort`): `<command-name>` first, then its terminal output. */
function localCommand(command: string, args = ''): string {
  return `<command-name>${command}</command-name>\n<command-message>${command.slice(1)}</command-message>\n<command-args>${args}</command-args>`
}

function runningAs(command: string, startedAt: string | null = null) {
  return async (pids: readonly number[]) => new Map(pids.map((pid) => [pid, { command, startedAt }]))
}

const allClaude = runningAs('claude')

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
      pidDomain: null,
      sessionId: 'session-a',
      cwd: '/repo/.claude/worktrees/feature',
      startedAt: 1_788_449_285_638,
      version: '2.1.259',
      kind: 'interactive',
      entrypoint: 'cli',
      procStart: null,
      name: 'agent-zen-ef',
      nameSource: 'derived',
      status: 'waiting',
      waitingFor: 'dialog open',
      statusUpdatedAt: 1_788_477_420_245,
    })
    expect(parseRegistryEntry('not json')).toBeNull()
    // `shell` is an idle prompt with a background shell; an unknown status stays on the board as idle.
    expect(parseRegistryEntry(registryEntry({ status: 'shell' }))?.status).toBe('idle')
    expect(parseRegistryEntry(registryEntry({ status: 'confused' }))?.status).toBe('idle')
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
      processes: async (pids) => new Map(pids
        .filter((pid) => pid !== 2)
        .map((pid) => [pid, { command: pid === 5 ? 'python3' : '/usr/local/bin/claude', startedAt: null }])),
    })
    expect(live).toEqual({
      entries: [expect.objectContaining({ sessionId: 'busy' })],
      processRejections: [{ pid: 5, sessionId: 'idle', command: 'python3' }],
      unverified: 0,
    })
    expect(await readLiveRegistry({ directory: join(home, 'nope') })).toBeNull()
  })

  test('keeps one card per session, skips reused pids and never guesses when the process check fails', async () => {
    const home = await claudeHome()
    const directory = join(home, 'sessions')
    // A resumed session running twice: the one waiting on you wins over a newer idle one.
    await writeFile(join(directory, '10.json'), registryEntry({ pid: 10, sessionId: 'resumed', status: 'waiting', startedAt: 1_000 }))
    await writeFile(join(directory, '11.json'), registryEntry({ pid: 11, sessionId: 'resumed', status: 'idle', startedAt: 2_000 }))
    // Equal attention: the newest process wins.
    await writeFile(join(directory, '14.json'), registryEntry({ pid: 14, sessionId: 'twin', status: 'idle', startedAt: 3_000 }))
    await writeFile(join(directory, '15.json'), registryEntry({ pid: 15, sessionId: 'twin', status: 'idle', startedAt: 4_000 }))
    // Left behind by a crash; the pid now belongs to a process that started later.
    await writeFile(join(directory, '12.json'), registryEntry({ pid: 12, sessionId: 'crashed', procStart: 'Thu Sep  4 13:28:34 2026' }))
    await writeFile(join(directory, '13.json'), registryEntry({ pid: 13, sessionId: 'same-start', procStart: 'Thu Sep  4 13:28:34 2026' }))

    const live = await readLiveRegistry({
      directory,
      processes: async (pids) => new Map(pids.map((pid) => [pid, {
        command: pid === 12 ? 'python3' : 'claude',
        startedAt: pid === 12 ? 'Mon Sep 28 09:30:35 2026' : 'Thu Sep 4 13:28:34 2026',
      }])),
    })

    expect(live?.entries.map((entry) => [entry.sessionId, entry.pid])).toEqual([
      ['same-start', 13],
      ['twin', 15],
      ['resumed', 10],
    ])
    expect(live?.processRejections).toEqual([])
    expect(await readLiveRegistry({
      directory,
      processes: async () => {
        throw new Error('ps timed out')
      },
    })).toEqual({ entries: [], processRejections: [], unverified: 6 })
    await expect(readLiveRegistry({ directory: join(directory, '10.json') })).rejects.toThrow()
  })

  test('reads the real process table in the zone and locale Claude Code records', async () => {
    const home = await claudeHome()
    const directory = join(home, 'sessions')
    await writeFile(join(directory, `${process.pid}.json`), registryEntry({ pid: process.pid, sessionId: 'this-process' }))
    await writeFile(join(directory, '99990.json'), registryEntry({ pid: 99_990, sessionId: 'gone' }))

    const live = await readLiveRegistry({ directory })

    // The test runner is not Claude Code, so its own pid is a rejection; the dead pid simply vanishes.
    expect(live?.entries).toEqual([])
    expect(live?.processRejections).toEqual([
      { pid: process.pid, sessionId: 'this-process', command: expect.stringMatching(/bun/i) },
    ])
    expect(live?.unverified).toBe(0)

    // `ps` refuses the whole call for a pid above XNU's PID_MAX, so such a file, or one from
    // another process table, is skipped up front instead of making every session unverifiable.
    await writeFile(join(directory, '99999999.json'), registryEntry({ pid: 99_999_999, sessionId: 'impossible' }))
    await writeFile(join(directory, '4242.json'), registryEntry({ pid: 4242, sessionId: 'container', pidDomain: 'linux' }))
    expect(await readLiveRegistry({ directory })).toEqual({
      entries: [],
      processRejections: [{ pid: process.pid, sessionId: 'this-process', command: expect.stringMatching(/bun/i) }],
      unverified: 0,
    })

    // `ps` exits 1 silently when no pid is running (an answer) and with a message on a bad pid (a failure).
    expect(await runningProcesses([99_990])).toEqual(new Map())
    await expect(runningProcesses([99_999_999])).rejects.toThrow()
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
    fold(humanPrompt(skillCommand('/wrapup', 'quickly'), { uuid: 'p2', timestamp: '2026-09-04T00:20:00.000Z' }))
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
      wrapupStarted: true,
      tasks: [],
      tasksRevision: 0,
      tasksUpdatedAt: null,
      pendingTaskCalls: {},
    })
  })

  test('a loaded wrapup skill holds Wrapping up for the rest of the session; a review skill lasts its turn', () => {
    let snapshot = EMPTY_TRANSCRIPT
    const fold = (record: string) => { snapshot = applyTranscriptRecord(snapshot, record) }
    fold(humanPrompt('Have a look at the visual output', { uuid: 'p1' }))
    fold(assistantToolUse('Skill', 'skill-1', { skill: 'visual-review' }))
    expect(snapshot.stageHint).toBe('reviewing')
    fold(humanPrompt('Looks fine, carry on', { uuid: 'p2' }))
    expect(snapshot.stageHint).toBeNull()

    fold(assistantToolUse('Skill', 'skill-2', { skill: 'wrapup' }, { isSidechain: true }))
    expect(snapshot.stageHint).toBeNull()
    fold(humanPrompt('ok wrap up', { uuid: 'p3' }))
    expect(snapshot.stageHint).toBeNull()
    fold(assistantToolUse('Skill', 'skill-3', { skill: 'wrapup' }))
    fold(assistantToolUse('Skill', 'skill-4', { skill: 'code-review' }))
    expect(snapshot).toMatchObject({ stageHint: 'wrapping-up', wrapupStarted: true })

    fold(humanPrompt('yes, merge it', { uuid: 'p4' }))
    fold(assistantToolUse('Skill', 'skill-5', { skill: 'visual-review' }))
    expect(snapshot).toMatchObject({ turnId: 'p4', stageHint: 'wrapping-up', wrapupStarted: true })
  })

  test('folds the task tools into the current task list, counting only calls that succeeded', () => {
    let snapshot = EMPTY_TRANSCRIPT
    const fold = (record: string) => { snapshot = applyTranscriptRecord(snapshot, record) }
    fold(humanPrompt('Plan it out', { uuid: 'p1' }))
    fold(assistantToolUse('TaskCreate', 'create-2', { subject: 'Write tests', description: 'd', activeForm: 'Writing tests' }))
    fold(toolResult('create-2', { task: { id: '2', subject: 'Write tests' } }, '2026-09-29T10:00:00.000Z'))
    fold(assistantToolUse('TaskCreate', 'create-1', { subject: 'Read the code', description: 'd' }))
    fold(toolResult('create-1', { task: { id: '1', subject: 'Read the code' } }, '2026-09-29T10:01:00.000Z'))
    fold(assistantToolUse('TaskCreate', 'create-3', { subject: 'Ship it', description: 'd' }))
    fold(toolResult('create-3', { task: { id: '3', subject: 'Ship it' } }, '2026-09-29T10:02:00.000Z'))
    fold(assistantToolUse('TaskUpdate', 'update-1', { taskId: '1', status: 'completed' }))
    fold(toolResult('update-1', { success: true, taskId: '1', updatedFields: ['status'] }, '2026-09-29T10:03:00.000Z'))
    fold(assistantToolUse('TaskUpdate', 'update-2', { taskId: '2', status: 'in_progress', subject: 'Write the tests' }))
    fold(toolResult('update-2', { success: true, taskId: '2', updatedFields: ['status', 'subject'] }, '2026-09-29T10:04:00.000Z'))
    fold(assistantToolUse('TaskUpdate', 'update-3', { taskId: '3', status: 'deleted' }))
    fold(toolResult('update-3', { success: true, taskId: '3', updatedFields: ['status'] }, '2026-09-29T10:05:00.000Z'))
    fold(assistantToolUse('TaskUpdate', 'update-4', { taskId: '2', status: 'completed' }))
    fold(toolResult('update-4', { success: false, taskId: '2', updatedFields: [], error: 'Task not found' }, '2026-09-29T10:06:00.000Z'))
    fold(assistantToolUse('TaskCreate', 'create-4', { subject: 'Subagent work', description: 'd' }, { isSidechain: true }))

    expect({
      tasks: snapshot.tasks,
      tasksRevision: snapshot.tasksRevision,
      tasksUpdatedAt: snapshot.tasksUpdatedAt,
      pendingTaskCalls: snapshot.pendingTaskCalls,
    }).toEqual({
      tasks: [
        { id: '1', subject: 'Read the code', status: 'completed' },
        { id: '2', subject: 'Write the tests', status: 'in_progress' },
      ],
      tasksRevision: 6,
      tasksUpdatedAt: '2026-09-29T10:05:00.000Z',
      pendingTaskCalls: {},
    })
  })

  test('only a human prompt that reaches the model starts a turn', () => {
    let snapshot = EMPTY_TRANSCRIPT
    const fold = (record: string) => { snapshot = applyTranscriptRecord(snapshot, record) }
    fold(humanPrompt(localCommand('/effort', 'high'), { uuid: 'local', promptSource: undefined }))
    fold(humanPrompt('<local-command-stdout>Set effort level to high</local-command-stdout>', { uuid: 'stdout', promptSource: undefined }))
    expect(snapshot.turnId).toBeNull()
    expect(snapshot.firstPrompt).toBeNull()

    fold(humanPrompt(skillCommand('/wrapup'), { uuid: 'wrapup', origin: { kind: 'human' }, promptSource: undefined }))
    fold(line({ type: 'assistant', message: { role: 'assistant', model: 'claude-fable-5-1', content: [] } }))
    const afterWrapup = snapshot
    expect(afterWrapup).toMatchObject({
      turnId: 'wrapup',
      firstPrompt: '/wrapup',
      stageHint: 'wrapping-up',
      hasSubstantiveActivity: true,
    })

    fold(humanPrompt('<task-notification>background task done</task-notification>', {
      uuid: 'task',
      origin: { kind: 'task-notification' },
      promptSource: 'system',
    }))
    fold(humanPrompt('Summary of the conversation so far', { uuid: 'compact', isCompactSummary: true, promptSource: undefined }))
    fold(humanPrompt('[Request interrupted by user]', { uuid: 'interrupt', promptSource: undefined }))
    fold(humanPrompt('<bash-input>git status</bash-input>', { uuid: 'bash' }))
    fold(humanPrompt('<ci-monitor-event>checks passed</ci-monitor-event>', { uuid: 'ci', promptSource: 'sdk' }))
    fold(humanPrompt(localCommand('/model'), { uuid: 'model', promptSource: undefined }))
    fold(humanPrompt('A plain line from elsewhere', { uuid: 'other-origin', origin: { kind: 'task-notification' } }))

    expect(snapshot).toEqual(afterWrapup)
  })

  test('reads a workflow stage from tagged and typed slash commands only', () => {
    const nativeWrapup = skillCommand('/wrapup')
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
        humanPrompt(skillCommand('/wrapup'), { uuid: 'p9' }),
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
      processes: allClaude,
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
      processes: allClaude,
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
        humanPrompt(skillCommand('/wrapup'), { uuid: 'wrapup-turn' }),
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
      processes: allClaude,
      gitOriginUrl: async () => 'git@github.com:lucharo/agent-zen.git',
    })

    const [session] = await backend.observe()

    expect(session?.hasSubstantiveActivity).toBe(false)
    expect(session?.turnOutcome).toBeNull()
    expect(session && classifySession(session).stage).toBe('idle')
  })

  test('a wrap-up stays on the card through follow-up replies and the transcript task list becomes the plan', async () => {
    const home = await claudeHome()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry({ status: 'idle' }))
    await writeFile(
      join(home, 'projects', '-repo', 'session-a.jsonl'),
      [
        humanPrompt('ok wrap up', { uuid: 'p1' }),
        assistantToolUse('Skill', 'skill-1', { skill: 'wrapup' }),
        assistantToolUse('TaskCreate', 'create-1', { subject: 'Merge the PR', description: 'd' }),
        toolResult('create-1', { task: { id: '1', subject: 'Merge the PR' } }, '2026-09-29T10:00:00.000Z'),
        humanPrompt('yes', { uuid: 'p2' }),
        line({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Merged.' }] } }),
      ].join('\n') + '\n',
    )
    await mkdir(join(home, 'tasks', 'session-a'))
    await writeFile(join(home, 'tasks', 'session-a', '1.json'), JSON.stringify({ id: '1', subject: 'Stale file task', status: 'pending' }))
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [project],
      processes: allClaude,
      gitOriginUrl: async () => null,
    })

    const [session] = await backend.observe()

    expect(session?.plan).toEqual({
      revision: 1,
      updatedAt: '2026-09-29T10:00:00.000Z',
      explanation: null,
      steps: [{ step: 'Merge the PR', status: 'pending' }],
    })
    expect(classifySession(session!)).toEqual({ stage: 'wrapped-up', reason: 'wrapup-complete', needsUser: false })
  })

  test('composes a session resumed elsewhere from all its transcript segments', async () => {
    const home = await claudeHome()
    const startedAt = Date.now()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry({ startedAt }))
    await mkdir(join(home, 'projects', '-elsewhere'))
    const earlier = join(home, 'projects', '-repo', 'session-a.jsonl')
    const earlierRecords = [
      humanPrompt('ok wrap up', { uuid: 'p1' }),
      line({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', model: 'claude-opus-5-5', content: [
        { type: 'tool_use', id: 'skill-1', name: 'Skill', input: { skill: 'wrapup' } },
        { type: 'tool_use', id: 'create-1', name: 'TaskCreate', input: { subject: 'Merge the PR', description: 'd' } },
      ] } }),
      line({ ...JSON.parse(toolResult('create-1', { task: { id: '1', subject: 'Merge the PR' } }, '2026-09-29T10:00:00.000Z')), uuid: 'r1' }),
    ]
    await writeFile(earlier, earlierRecords.join('\n') + '\n')
    await utimes(earlier, new Date(startedAt - 60_000), new Date(startedAt - 60_000))
    // The resumed segment repeats the earlier history (same uuids), then finishes the task.
    await writeFile(join(home, 'projects', '-elsewhere', 'session-a.jsonl'), [
      ...earlierRecords,
      humanPrompt('yes', { uuid: 'p2' }),
      line({ type: 'assistant', uuid: 'a2', message: { role: 'assistant', model: 'claude-opus-5-5', content: [
        { type: 'tool_use', id: 'update-1', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
      ] } }),
      line({ ...JSON.parse(toolResult('update-1', { success: true, taskId: '1', updatedFields: ['status'] }, '2026-09-29T11:00:00.000Z')), uuid: 'r2' }),
    ].join('\n') + '\n')
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [],
      processes: allClaude,
      gitOriginUrl: async () => null,
    })

    const [session] = await backend.observe()

    expect(session?.turnId).toBe('p2')
    expect(session?.wrapup).toEqual({ checksPassed: null, checksTotal: null })
    expect(session?.plan).toEqual({
      revision: 2,
      updatedAt: '2026-09-29T11:00:00.000Z',
      explanation: null,
      steps: [{ step: 'Merge the PR', status: 'completed' }],
    })
  })

  test('a resumed segment that starts empty keeps the plan and wrap-up from before the resume', async () => {
    const home = await claudeHome()
    const startedAt = Date.now()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry({ startedAt }))
    await mkdir(join(home, 'projects', '-elsewhere'))
    const earlier = join(home, 'projects', '-repo', 'session-a.jsonl')
    await writeFile(earlier, [
      humanPrompt('ok wrap up', { uuid: 'p1' }),
      assistantToolUse('Skill', 'skill-1', { skill: 'wrapup' }),
      assistantToolUse('TaskCreate', 'create-1', { subject: 'Merge the PR', description: 'd' }),
      toolResult('create-1', { task: { id: '1', subject: 'Merge the PR' } }, '2026-09-29T10:00:00.000Z'),
    ].join('\n') + '\n')
    await utimes(earlier, new Date(startedAt - 60_000), new Date(startedAt - 60_000))
    await writeFile(join(home, 'projects', '-elsewhere', 'session-a.jsonl'), [
      humanPrompt('carry on', { uuid: 'p2' }),
      assistantToolUse('TaskUpdate', 'update-1', { taskId: '1', status: 'in_progress' }),
      toolResult('update-1', { success: true, taskId: '1', updatedFields: ['status'] }, '2026-09-29T11:00:00.000Z'),
    ].join('\n') + '\n')
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [],
      processes: allClaude,
      gitOriginUrl: async () => null,
    })

    const [session] = await backend.observe()

    expect(session?.turnId).toBe('p2')
    expect(session?.wrapup).toEqual({ checksPassed: null, checksTotal: null })
    expect(session?.plan?.steps).toEqual([{ step: 'Merge the PR', status: 'in_progress' }])
  })

  test('fails the observation rather than counting unverifiable live sessions as none', async () => {
    const home = await claudeHome()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry())
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [],
      processes: async () => {
        throw new Error('ps timed out')
      },
      gitOriginUrl: async () => null,
    })

    await expect(backend.observe()).rejects.toThrow('1 live Claude Code session could not be verified')
    await expect(backend.start()).resolves.toBeUndefined()
    expect(backend.status()).toMatchObject({ connected: false, label: 'Claude Code unavailable' })
  })

  test('follows a session resumed elsewhere to the transcript its current process writes', async () => {
    const home = await claudeHome()
    const startedAt = Date.now()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry({ startedAt }))
    const previous = join(home, 'projects', '-repo', 'session-a.jsonl')
    await writeFile(previous, humanPrompt('Before the resume', { uuid: 'before' }) + '\n')
    await utimes(previous, new Date(startedAt - 60_000), new Date(startedAt - 60_000))
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [],
      processes: allClaude,
      gitOriginUrl: async () => null,
    })

    expect((await backend.observe())[0]?.turnId).toBe('before')
    await mkdir(join(home, 'projects', '-elsewhere'))
    await writeFile(join(home, 'projects', '-elsewhere', 'session-a.jsonl'), humanPrompt('After the resume', { uuid: 'after' }) + '\n')

    expect((await backend.observe())[0]?.turnId).toBe('after')
  })

  test('reports process identity rejection instead of looking like no sessions exist', async () => {
    const home = await claudeHome()
    await writeFile(join(home, 'sessions', '4242.json'), registryEntry())
    const backend = new ClaudeBackend({
      claudeHome: home,
      getProjects: () => [],
      processes: runningAs('node'),
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
      processes: allClaude,
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
