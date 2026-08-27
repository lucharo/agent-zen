import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '../../src/domain/types'
import { deriveStage } from '../../src/domain/stage'
import { CodexStateObserver } from './stateObserver'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test('maps the read-only Codex state database and rollout tail into native sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-state-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      JSON.stringify({ timestamp: '2026-08-06T12:00:10.000Z', type: 'event_msg', payload: { type: 'user_message', message: '$wrapup\nPlease finish the work.' } }),
      JSON.stringify({
        timestamp: '2026-08-06T12:00:20.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal',
          input: 'const result = await tools.create_goal({objective:"Finish the native session observer."}); text(result);',
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-06T12:00:20.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal',
          output: [{
            type: 'input_text',
            text: JSON.stringify({
              goal: { objective: 'Finish the native session observer.', status: 'active' },
            }),
          }],
        },
      }),
      JSON.stringify({ timestamp: '2026-08-06T12:00:30.000Z', type: 'response_item', payload: { type: 'reasoning', text: 'x'.repeat(2_000) } }),
      JSON.stringify({
        timestamp: '2026-08-06T12:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: 'await tools.update_plan({plan:[{step:"Inspect",status:"completed"},{step:"Build",status:"in_progress"}]});',
        },
      }),
    ].join('\n') + '\n',
  )

  const database = new Database(dbPath, { create: true })
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      git_sha TEXT, git_branch TEXT, git_origin_url TEXT, cli_version TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '', name TEXT, model TEXT, reasoning_effort TEXT,
      created_at_ms INTEGER, updated_at_ms INTEGER
    );
    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT NOT NULL, child_thread_id TEXT NOT NULL PRIMARY KEY, status TEXT NOT NULL
    );
  `)
  database.query(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      git_sha, git_branch, git_origin_url, cli_version, preview, name, model,
      reasoning_effort, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'thread-1', rolloutPath, 1_786_012_800, 1_786_012_860, 'app', 'azure',
    '/repo', 'Fallback title', 'abc123', 'feat/live', 'git@github.com:lucharo/repo.git',
    '0.146.0', 'Preview', 'Live bridge', 'gpt-5.6-sol', 'xhigh', 1_786_012_800_000,
    1_786_012_860_000,
  )
  database.query(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      git_sha, git_branch, git_origin_url, cli_version, preview, name, model,
      reasoning_effort, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'roborev-1', rolloutPath, 1_786_012_800, 1_786_012_870, 'exec', 'azure',
    '/repo', 'You are a code reviewer. Review the code changes shown below. Return only the final review.',
    'abc123', 'feat/live', 'git@github.com:lucharo/repo.git', '0.146.0', '', null,
    'gpt-5.6-sol', 'xhigh', 1_786_012_800_000, 1_786_012_870_000,
  )
  database.query(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      git_sha, git_branch, git_origin_url, cli_version, preview, name, model,
      reasoning_effort, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'worktree-1', rolloutPath, 1_786_012_800, 1_786_012_865, 'app', 'azure',
    '/outside/main-checkout/worktrees/repo', 'External worktree', 'def456', 'feat/worktree',
    'https://github.com/lucharo/repo.git', '0.146.0', '', null, 'gpt-5.6-sol', 'high',
    1_786_012_800_000, 1_786_012_865_000,
  )
  database.close()

  const projects: Project[] = [{
    id: 'repo', name: 'repo', directory: '/repo', repository: 'lucharo/repo',
  }]
  const observer = new CodexStateObserver({
    dbPath,
    getProjects: () => projects,
    getActiveThreadIds: async () => null,
    maxRolloutBytes: 500,
  })
  const sessions = await observer.snapshot()

  expect(sessions).toHaveLength(2)
  const primary = sessions.find((session) => session.id === 'thread-1')
  expect(primary).toMatchObject({
    id: 'thread-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    title: 'Live bridge',
    source: 'external',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'xhigh',
    cliVersion: '0.146.0',
    repository: 'lucharo/repo',
    branch: 'feat/live',
    projectId: 'repo',
    activity: 'working',
  })
  expect(primary?.plan?.steps[1]).toEqual({ step: 'Build', status: 'in_progress' })
  expect(primary?.goal).toEqual({
    objective: 'Finish the native session observer.',
    status: 'active',
  })
  expect(primary?.wrapup).toEqual({ checksPassed: null, checksTotal: null })
  expect(sessions.find((session) => session.id === 'worktree-1')).toMatchObject({
    projectId: 'repo',
    repository: 'lucharo/repo',
    worktree: '/outside/main-checkout/worktrees/repo',
  })

  await appendFile(
    rolloutPath,
    `${JSON.stringify({ timestamp: '2026-08-06T12:02:00.000Z', type: 'response_item', payload: { type: 'reasoning', text: 'y'.repeat(2_000) } })}\n`,
  )
  const afterGrowth = await observer.snapshot()
  expect(afterGrowth.find((session) => session.id === 'thread-1')?.plan?.steps[1])
    .toEqual({ step: 'Build', status: 'in_progress' })
  expect(afterGrowth.find((session) => session.id === 'thread-1')?.goal)
    .toEqual({ objective: 'Finish the native session observer.', status: 'active' })
  expect(afterGrowth.find((session) => session.id === 'thread-1')?.wrapup)
    .toEqual({ checksPassed: null, checksTotal: null })

  await appendFile(
    rolloutPath,
    [
      JSON.stringify({
        timestamp: '2026-08-06T12:03:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal-blocked',
          input: `const result = await tools.update_goal({status:"blocked"}); text(result); // ${'z'.repeat(2_000)}`,
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-06T12:03:00.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal-blocked',
          output: [{
            type: 'input_text',
            text: JSON.stringify({
              goal: { objective: 'Finish the native session observer.', status: 'blocked' },
            }),
          }],
        },
      }),
    ].join('\n') + '\n',
  )
  expect((await observer.snapshot()).find((session) => session.id === 'thread-1')?.goal)
    .toEqual({ objective: 'Finish the native session observer.', status: 'blocked' })
})

test('keeps an idle unarchived thread visible while its Codex process still owns the rollout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-active-process-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const activeRollout = join(directory, 'rollout-active.jsonl')
  const staleRollout = join(directory, 'rollout-stale.jsonl')
  const completedTurn = [
    JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
    JSON.stringify({
      timestamp: '2026-08-06T12:01:00.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        input: 'await tools.update_plan({plan:[{step:"Build",status:"completed"}]});',
      },
    }),
    JSON.stringify({ timestamp: '2026-08-06T12:02:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }),
  ].join('\n') + '\n'
  await Promise.all([
    writeFile(activeRollout, completedTurn),
    writeFile(staleRollout, completedTurn),
  ])

  const database = new Database(dbPath, { create: true })
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      git_sha TEXT, git_branch TEXT, git_origin_url TEXT, cli_version TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '', name TEXT, model TEXT, reasoning_effort TEXT,
      created_at_ms INTEGER, updated_at_ms INTEGER
    );
    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT NOT NULL, child_thread_id TEXT NOT NULL PRIMARY KEY, status TEXT NOT NULL
    );
  `)
  const insert = database.query(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      cli_version, preview, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'cli', 'openai', '/repo', ?, '0.146.0', '', ?, ?)
  `)
  insert.run('thread-active', activeRollout, 1_786_012_800, 1_786_012_920, 'Human spec', 1_786_012_800_000, 1_786_012_920_000)
  insert.run('thread-stale', staleRollout, 1_786_012_700, 1_786_012_910, 'Old session', 1_786_012_700_000, 1_786_012_910_000)
  database.close()

  let processInventoryAvailable = true
  const observer = new CodexStateObserver({
    dbPath,
    getProjects: () => [],
    getActiveThreadIds: async () => processInventoryAvailable
      ? new Set(['thread-active'])
      : null,
  })

  const sessions = await observer.snapshot()

  expect(sessions.map((session) => session.id)).toEqual(['thread-active'])
  expect(sessions[0]).toMatchObject({
    activity: 'idle',
    endedAt: null,
    hasSubstantiveActivity: true,
    plan: { steps: [{ step: 'Build', status: 'completed' }] },
  })
  expect(deriveStage(sessions[0]!)).toBe('idle')

  processInventoryAvailable = false
  expect((await observer.snapshot()).map((session) => session.id)).toEqual(['thread-active'])
})

test('recovers planless substantive work after it falls outside the bounded rollout tail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-activity-anchor-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      JSON.stringify({ timestamp: '2026-08-06T12:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Work without a plan' } }),
      JSON.stringify({ timestamp: '2026-08-06T12:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } }),
      JSON.stringify({ timestamp: '2026-08-06T12:00:03.000Z', type: 'response_item', payload: { type: 'reasoning', text: 'x'.repeat(5_000) } }),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-planless', rolloutPath)

  const observer = new CodexStateObserver({
    dbPath,
    getProjects: () => [],
    getActiveThreadIds: async () => new Set(['thread-planless']),
    maxRolloutBytes: 400,
  })
  const [session] = await observer.snapshot()

  expect(session).toMatchObject({
    activity: 'working',
    hasSubstantiveActivity: true,
    plan: null,
  })
  expect(session && deriveStage(session)).toBe('running')
})

test('recovers the current turn across an oversized irrelevant rollout record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-oversized-rollout-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      JSON.stringify({ timestamp: '2026-08-06T12:00:01.000Z', type: 'response_item', payload: { type: 'reasoning', text: 'x'.repeat(300_000) } }),
      JSON.stringify({ timestamp: '2026-08-06T12:00:02.000Z', type: 'event_msg', payload: { type: 'task_complete' } }),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-oversized', rolloutPath)

  const observer = new CodexStateObserver({
    dbPath,
    getProjects: () => [],
    getActiveThreadIds: async () => new Set(['thread-oversized']),
    maxRolloutBytes: 400,
  })
  const [session] = await observer.snapshot()

  expect(session).toMatchObject({
    turnId: 'turn-1',
    activity: 'idle',
    hasSubstantiveActivity: false,
  })
})

test('retains a completed wrap-up invocation outside the bounded rollout tail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-wrapup-anchor-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      JSON.stringify({
        timestamp: '2026-08-27T14:48:45.914Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Thanks for the fixes, $wrapup close everything out' }],
        },
      }),
      oversizedReasoning('2026-08-06T12:00:02.000Z'),
      JSON.stringify({ timestamp: '2026-08-06T12:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-wrapup-anchor', rolloutPath)
  const observer = boundedObserver(dbPath, 'thread-wrapup-anchor')

  const [session] = await observer.snapshot()

  expect(session).toMatchObject({
    activity: 'idle',
    turnOutcome: 'completed',
    wrapup: { checksPassed: null, checksTotal: null },
  })
  expect(session && deriveStage(session)).toBe('wrapped-up')
})

test('does not reuse a cached turn when a new turn start falls behind an oversized record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-cached-turn-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      JSON.stringify({ timestamp: '2026-08-06T12:00:01.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-cached-turn', rolloutPath)
  const observer = new CodexStateObserver({
    dbPath,
    getProjects: () => [],
    getActiveThreadIds: async () => new Set(['thread-cached-turn']),
    maxRolloutBytes: 400,
  })

  expect((await observer.snapshot())[0]?.turnId).toBe('turn-1')

  await appendFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:01:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } }),
      JSON.stringify({ timestamp: '2026-08-06T12:01:01.000Z', type: 'response_item', payload: { type: 'reasoning', text: 'x'.repeat(300_000) } }),
    ].join('\n') + '\n',
  )

  expect((await observer.snapshot())[0]).toMatchObject({
    turnId: 'turn-2',
    activity: 'working',
  })
})

test('does not reuse a cached plan when a same-turn update falls behind an oversized record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-cached-plan-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      planRecord('2026-08-06T12:00:01.000Z', 'Old plan'),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-cached-plan', rolloutPath)
  const observer = boundedObserver(dbPath, 'thread-cached-plan')

  expect((await observer.snapshot())[0]?.plan?.steps[0]?.step).toBe('Old plan')

  await appendFile(
    rolloutPath,
    [
      planRecord('2026-08-06T12:01:00.000Z', 'Current plan'),
      oversizedReasoning('2026-08-06T12:01:01.000Z'),
    ].join('\n') + '\n',
  )

  expect((await observer.snapshot())[0]?.plan?.steps[0]?.step).toBe('Current plan')
})

test('discovers a same-turn input request behind an oversized record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-cached-input-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    `${JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } })}\n`,
  )
  createStateDatabase(dbPath, 'thread-cached-input', rolloutPath)
  const observer = boundedObserver(dbPath, 'thread-cached-input')

  expect((await observer.snapshot())[0]?.activity).toBe('working')

  await appendFile(
    rolloutPath,
    [
      inputRequestRecord('2026-08-06T12:01:00.000Z', 'call-new-input'),
      oversizedReasoning('2026-08-06T12:01:01.000Z'),
    ].join('\n') + '\n',
  )

  expect((await observer.snapshot())[0]?.activity).toBe('awaiting-input')
})

test('does not retain a cached input request when its resolution falls behind an oversized record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-resolved-input-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      inputRequestRecord('2026-08-06T12:00:01.000Z', 'call-resolved-input'),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-resolved-input', rolloutPath)
  const observer = boundedObserver(dbPath, 'thread-resolved-input')

  expect((await observer.snapshot())[0]?.activity).toBe('awaiting-input')

  await appendFile(
    rolloutPath,
    [
      inputResolutionRecord('2026-08-06T12:01:00.000Z', 'call-resolved-input'),
      oversizedReasoning('2026-08-06T12:01:01.000Z'),
    ].join('\n') + '\n',
  )

  expect((await observer.snapshot())[0]?.activity).toBe('working')
})

test('does not reuse a cached goal when an update falls behind an oversized record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-cached-goal-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      ...goalRecords('2026-08-06T12:00:01', 'call-goal-a', 'Goal A'),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-cached-goal', rolloutPath)
  const observer = boundedObserver(dbPath, 'thread-cached-goal')

  expect((await observer.snapshot())[0]?.goal?.objective).toBe('Goal A')

  await appendFile(
    rolloutPath,
    [
      ...goalRecords('2026-08-06T12:01:00', 'call-goal-b', 'Goal B'),
      oversizedReasoning('2026-08-06T12:01:01.000Z'),
    ].join('\n') + '\n',
  )

  expect((await observer.snapshot())[0]?.goal?.objective).toBe('Goal B')
})

test('recovers a goal result whose call predates the cached file boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-split-goal-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  const [goalBCall, goalBResult] = goalRecords('2026-08-06T12:01:00', 'call-goal-b', 'Goal B')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      ...goalRecords('2026-08-06T12:00:01', 'call-goal-a', 'Goal A'),
      goalBCall,
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-split-goal', rolloutPath)
  const observer = boundedObserver(dbPath, 'thread-split-goal')

  expect((await observer.snapshot())[0]?.goal?.objective).toBe('Goal A')

  await appendFile(
    rolloutPath,
    [goalBResult!, oversizedReasoning('2026-08-06T12:01:01.000Z')].join('\n') + '\n',
  )

  expect((await observer.snapshot())[0]?.goal?.objective).toBe('Goal B')
})

test('keeps a goal update that precedes a new turn outside the bounded tail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-cross-turn-goal-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      ...goalRecords('2026-08-06T12:00:01', 'call-goal-a', 'Goal A'),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-cross-turn-goal', rolloutPath)
  const observer = boundedObserver(dbPath, 'thread-cross-turn-goal')

  expect((await observer.snapshot())[0]?.goal?.objective).toBe('Goal A')

  await appendFile(
    rolloutPath,
    [
      ...goalRecords('2026-08-06T12:01:00', 'call-goal-b', 'Goal B'),
      JSON.stringify({ timestamp: '2026-08-06T12:02:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } }),
      oversizedReasoning('2026-08-06T12:02:01.000Z'),
    ].join('\n') + '\n',
  )

  expect((await observer.snapshot())[0]).toMatchObject({
    turnId: 'turn-2',
    goal: { objective: 'Goal B', status: 'active' },
  })
})

test('does not rescan goal-less rollout history after every append', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-goal-less-cache-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    `${JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } })}\n`,
  )
  createStateDatabase(dbPath, 'thread-goal-less-cache', rolloutPath)
  let goalHistoryReads = 0
  const observer = new CodexStateObserver({
    dbPath,
    getProjects: () => [],
    getActiveThreadIds: async () => new Set(['thread-goal-less-cache']),
    maxRolloutBytes: 400,
    readGoalHistory: async () => {
      goalHistoryReads += 1
      return []
    },
  })

  await observer.snapshot()
  for (const [timestamp, text] of [
    ['2026-08-06T12:01:00.000Z', 'first append'],
    ['2026-08-06T12:02:00.000Z', 'second append'],
  ] as const) {
    await appendFile(
      rolloutPath,
      `${JSON.stringify({ timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: text } })}\n`,
    )
    await observer.snapshot()
  }

  expect(goalHistoryReads).toBe(1)
})

test('retains a native input request when process inventory is temporarily unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-input-fallback-'))
  cleanup.push(directory)
  const dbPath = join(directory, 'state.sqlite')
  const rolloutPath = join(directory, 'rollout.jsonl')
  await writeFile(
    rolloutPath,
    [
      JSON.stringify({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      JSON.stringify({ timestamp: '2026-08-06T12:01:00.000Z', type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'call-1' } }),
    ].join('\n') + '\n',
  )
  createStateDatabase(dbPath, 'thread-input', rolloutPath)

  const observer = new CodexStateObserver({
    dbPath,
    getProjects: () => [],
    getActiveThreadIds: async () => null,
  })

  expect(await observer.snapshot()).toMatchObject([{
    id: 'thread-input',
    activity: 'awaiting-input',
    hasSubstantiveActivity: true,
  }])
})

function boundedObserver(dbPath: string, threadId: string): CodexStateObserver {
  return new CodexStateObserver({
    dbPath,
    getProjects: () => [],
    getActiveThreadIds: async () => new Set([threadId]),
    maxRolloutBytes: 400,
  })
}

function planRecord(timestamp: string, step: string): string {
  return JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'exec',
      input: `await tools.update_plan({plan:[{step:${JSON.stringify(step)},status:"in_progress"}]});`,
    },
  })
}

function inputRequestRecord(timestamp: string, callId: string): string {
  return JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: { type: 'function_call', name: 'request_user_input', call_id: callId },
  })
}

function inputResolutionRecord(timestamp: string, callId: string): string {
  return JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: callId, output: 'answered' },
  })
}

function goalRecords(timestampPrefix: string, callId: string, objective: string): string[] {
  return [
    JSON.stringify({
      timestamp: `${timestampPrefix}.000Z`,
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: callId,
        input: `const result = await tools.create_goal({objective:${JSON.stringify(objective)}}); text(result);`,
      },
    }),
    JSON.stringify({
      timestamp: `${timestampPrefix}.100Z`,
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: callId,
        output: [{
          type: 'input_text',
          text: JSON.stringify({ goal: { objective, status: 'active' } }),
        }],
      },
    }),
  ]
}

function oversizedReasoning(timestamp: string): string {
  return JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: { type: 'reasoning', text: 'x'.repeat(300_000) },
  })
}

function createStateDatabase(dbPath: string, id: string, rolloutPath: string): void {
  const database = new Database(dbPath, { create: true })
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      git_sha TEXT, git_branch TEXT, git_origin_url TEXT, cli_version TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '', name TEXT, model TEXT, reasoning_effort TEXT,
      created_at_ms INTEGER, updated_at_ms INTEGER
    );
    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT NOT NULL, child_thread_id TEXT NOT NULL PRIMARY KEY, status TEXT NOT NULL
    );
  `)
  database.query(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      cli_version, preview, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'cli', 'openai', '/repo', ?, '0.147.0', '', ?, ?)
  `).run(id, rolloutPath, 1_786_012_800, 1_786_012_920, id, 1_786_012_800_000, 1_786_012_920_000)
  database.close()
}
