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
    expect(result.hasSubstantiveActivity).toBe(true)
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

  test('distinguishes planless work from a just-started turn', () => {
    const justStarted = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Update dotfiles' } }),
    ])
    const working = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:00:01.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'git status --short' } }),
    ])

    expect(justStarted.hasSubstantiveActivity).toBe(false)
    expect(working.hasSubstantiveActivity).toBe(true)
    expect(working.plan).toBeNull()
  })

  test('counts visible assistant and tool work, but not user input or hidden reasoning', () => {
    const records = [
      { payload: { type: 'message', role: 'assistant' }, expected: true },
      { payload: { type: 'function_call', name: 'wait', call_id: 'call-1' }, expected: true },
      { payload: { type: 'web_search_call' }, expected: true },
      { payload: { type: 'message', role: 'user' }, expected: false },
      { payload: { type: 'reasoning' }, expected: false },
    ]

    for (const [index, record] of records.entries()) {
      const snapshot = parseRolloutLines([
        line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
        line({ timestamp: `2026-08-06T12:00:0${index + 1}.000Z`, type: 'response_item', payload: record.payload }),
      ])
      expect(snapshot.hasSubstantiveActivity).toBe(record.expected)
    }
  })

  test('marks an unresolved native input request as needing the user', () => {
    const waiting = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:01:00.000Z', type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'call-1' } }),
    ])
    const resumed = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:01:00.000Z', type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'call-1' } }),
      line({ timestamp: '2026-08-06T12:02:00.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1' } }),
    ])

    expect(waiting.activity).toBe('awaiting-input')
    expect(waiting.hasSubstantiveActivity).toBe(true)
    expect(resumed.activity).toBe('working')
  })

  test('keeps needing the user until every matching input request resolves', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:01:00.000Z', type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'call-1' } }),
      line({ timestamp: '2026-08-06T12:01:01.000Z', type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: 'call-2' } }),
      line({ timestamp: '2026-08-06T12:01:02.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'wrong-call' } }),
      line({ timestamp: '2026-08-06T12:01:03.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1' } }),
    ])

    expect(snapshot.activity).toBe('awaiting-input')
    expect(snapshot.pendingInputCallIds).toEqual(['call-2'])
  })

  test('does not mark an auto-resolving input request as needing the user', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({
        timestamp: '2026-08-06T12:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'request_user_input',
          call_id: 'call-1',
          arguments: JSON.stringify({ autoResolutionMs: 60_000, questions: [] }),
        },
      }),
    ])

    expect(snapshot.activity).toBe('working')
    expect(snapshot.pendingInputCallIds).toEqual([])
  })

  test('does not promote a broader implementation turn merely because it reads a review skill', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Please run the visual review before handoff.' } }),
      line({
        timestamp: '2026-08-06T12:00:01.500Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: 'sed -n \'1,240p\' /Users/me/.refined/skills/visual/visual-review/SKILL.md',
        },
      }),
      line({ timestamp: '2026-08-06T12:00:02.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Also check the mobile layout.' } }),
    ])

    expect(result.stageHint).toBeNull()
  })

  test('does not confuse an unrelated workflow helper with review stage', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-07T17:04:48.999Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-07T17:04:49.065Z', type: 'event_msg', payload: { type: 'user_message', message: 'Restart ACM without losing the current state.' } }),
      line({
        timestamp: '2026-08-07T17:04:58.980Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: "sed -n '1,260p' /Users/me/.agents/skills/acm-review/SKILL.md",
        },
      }),
    ])

    expect(result.stageHint).toBeNull()
    expect(result.hasSubstantiveActivity).toBe(true)
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
          message: '$webapp-agent-demo',
        },
      }),
    ])

    expect(snapshot.stageHint).toBe('reviewing')
  })

  test('does not treat discussion of a skill as an invocation', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-06T10:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-4' } }),
      line({
        timestamp: '2026-08-06T10:01:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Sometimes I mention $wrapup while explaining the stage, but I am not invoking it.',
        },
      }),
    ])

    expect(snapshot.stageHint).toBeNull()
  })

  test('does not treat a quoted standalone command later in prose as an invocation', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-06T10:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-4' } }),
      line({
        timestamp: '2026-08-06T10:01:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'The documentation contains this example:\n$wrapup\nDo not invoke it.',
        },
      }),
    ])

    expect(snapshot.stageHint).toBeNull()
  })

  test('does not promote natural-language wrap-up discussion plus a skill read', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-06T10:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-5' } }),
      line({ timestamp: '2026-08-06T10:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Okay, we are done, wrap up.' } }),
      line({
        timestamp: '2026-08-06T10:01:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: 'sed -n \'1,220p\' /Users/me/.refined/skills/engineering/wrapup/SKILL.md',
        },
      }),
    ])

    expect(snapshot.stageHint).toBeNull()
  })

  test('recognises an explicit wrapup skill link inside the app request envelope', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-10T16:57:00.382Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-taskflow' } }),
      line({
        timestamp: '2026-08-10T16:57:06.345Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: [
            '# In app browser:',
            '- Current URL: file:///Users/me/review.html',
            '',
            '## My request for Codex:',
            '',
            'cool [$wrapup](/Users/me/.refined/skills/engineering/wrapup/SKILL.md)',
          ].join('\n'),
        },
      }),
    ])

    expect(snapshot.stageHint).toBe('wrapping-up')
  })

  test('ignores workflow skill paths mentioned inside diagnostic tool input', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-10T17:10:10.228Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-diagnosis' } }),
      line({ timestamp: '2026-08-10T17:10:11.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Investigate why classification is wrong.' } }),
      line({
        timestamp: '2026-08-10T17:11:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          input: 'Explain why /wrapup/SKILL.md in a diagnostic command must not change stage.',
        },
      }),
    ])

    expect(snapshot.stageHint).toBeNull()
  })

  test('requires an explicit skill link label to match its target skill directory', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-10T17:10:10.228Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-link' } }),
      line({
        timestamp: '2026-08-10T17:10:11.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '[$visual-review](/Users/me/.refined/skills/engineering/wrapup/SKILL.md)',
        },
      }),
    ])

    expect(snapshot.stageHint).toBeNull()
  })

  test('does not invoke a workflow link quoted as inline code', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-10T17:10:10.228Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-code' } }),
      line({
        timestamp: '2026-08-10T17:10:11.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'The `[$wrapup](/Users/me/.refined/skills/engineering/wrapup/SKILL.md)` marker is being misclassified.',
        },
      }),
    ])

    expect(snapshot.stageHint).toBeNull()
  })

  test('does not invoke a workflow link negated in the user request', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-10T17:10:10.228Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-negated' } }),
      line({
        timestamp: '2026-08-10T17:10:11.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Do not invoke [$wrapup](/Users/me/.refined/skills/engineering/wrapup/SKILL.md)',
        },
      }),
    ])

    expect(snapshot.stageHint).toBeNull()
  })

  test('does not invoke a workflow link used as the subject of a question', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-10T17:10:10.228Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-question' } }),
      line({
        timestamp: '2026-08-10T17:10:11.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Why does [$wrapup](/Users/me/.refined/skills/engineering/wrapup/SKILL.md) change classification?',
        },
      }),
    ])

    expect(snapshot.stageHint).toBeNull()
  })

  test('recognises an explicit wrapup skill link after natural acknowledgement', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-10T17:02:29.939Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-demo-project' } }),
      line({
        timestamp: '2026-08-10T17:02:30.040Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'right, very cool, i think i am happy after having seen that, more confident that most things have been implemented! [$wrapup](/Users/me/.refined/skills/engineering/wrapup/SKILL.md)',
        },
      }),
    ])

    expect(snapshot.stageHint).toBe('wrapping-up')
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
