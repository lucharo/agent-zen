import { describe, expect, test } from 'bun:test'
import { parseRolloutLines } from './rollout'

const line = (value: unknown) => JSON.stringify(value)

describe('parseRolloutLines', () => {
  test('derives the current turn and latest replacement plan without a second ledger', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Build the bridge' } }),
      line({
        timestamp: '2026-08-06T12:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: 'const p = await tools.update_plan({plan:[{step:"Plan",status:"completed"},{step:"Build",status:"in_progress"}]}); text(p);',
        },
      }),
      line({
        timestamp: '2026-08-06T12:05:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: 'await tools.update_plan({explanation:"Bridge is live.",plan:[{step:"Plan",status:"completed"},{step:"Build",status:"completed"},{step:"Review",status:"in_progress"}]});',
        },
      }),
    ])

    expect(result.activity).toBe('working')
    expect(result.turnId).toBe('turn-1')
    expect(result.turnStartedAt).toBe('2026-08-06T12:00:00.000Z')
    expect(result.plan?.explanation).toBe('Bridge is live.')
    expect(result.plan?.steps).toEqual([
      { step: 'Plan', status: 'completed' },
      { step: 'Build', status: 'completed' },
      { step: 'Review', status: 'in_progress' },
    ])
    expect(result.planHistory).toHaveLength(1)
  })

  test('marks a completed turn as ended until the thread is resumed', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:10:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }),
    ])

    expect(result.activity).toBe('ended')
    expect(result.endedAt).toBe('2026-08-06T12:10:00.000Z')
  })

  test('keeps an explicit review skill marker for the rest of the active turn', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Please run $visual-review before handoff.' } }),
      line({ timestamp: '2026-08-06T12:00:02.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Also check the mobile layout.' } }),
    ])

    expect(result.stageHint).toBe('reviewing')
  })

  test('moves from review to wrapping up only on an explicit wrapup invocation', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Please run $roborev-review.' } }),
      line({ timestamp: '2026-08-06T12:05:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: '$wrapup' } }),
    ])

    expect(result.stageHint).toBe('wrapping-up')
  })

  test('treats the explicit webapp demo validation skill as review work', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-06T10:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-3' } }),
      line({
        timestamp: '2026-08-06T10:01:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Validate the finished interface with $webapp-agent-demo.',
        },
      }),
    ])

    expect(snapshot.stageHint).toBe('reviewing')
  })

  test('resets the previous turn stage marker when a new task starts', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-06T10:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T10:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: '$wrapup' } }),
      line({ timestamp: '2026-08-06T10:02:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T10:03:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } }),
      line({ timestamp: '2026-08-06T10:04:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Continue ordinary implementation.' } }),
    ])

    expect(snapshot.turnId).toBe('turn-2')
    expect(snapshot.stageHint).toBeNull()
  })
})
