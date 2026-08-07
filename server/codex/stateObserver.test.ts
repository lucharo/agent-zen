import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '../../src/domain/types'
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
  expect(primary?.wrapup).toEqual({ checksPassed: 0, checksTotal: 1 })
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
  expect(afterGrowth.find((session) => session.id === 'thread-1')?.wrapup)
    .toEqual({ checksPassed: 0, checksTotal: 1 })
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
    plan: { steps: [{ step: 'Build', status: 'completed' }] },
  })

  processInventoryAvailable = false
  expect((await observer.snapshot()).map((session) => session.id)).toEqual(['thread-active'])
})
