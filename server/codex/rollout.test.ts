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
})
