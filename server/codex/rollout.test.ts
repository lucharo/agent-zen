import { describe, expect, test } from 'bun:test'
import { parseRolloutLines } from './rollout'

const line = (value: unknown) => JSON.stringify(value)

describe('parseRolloutLines', () => {
  test('reads native collaboration mode and resets it for a new turn', () => {
    const planning = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:00:00.100Z', type: 'turn_context', payload: { collaboration_mode: { mode: 'plan' } } }),
    ])
    const nextTurn = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'turn_context', payload: { collaboration_mode: { mode: 'plan' } } }),
      line({ timestamp: '2026-08-06T12:10:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } }),
    ])

    expect(planning.collaborationMode).toBe('plan')
    expect(nextTurn.collaborationMode).toBeNull()
  })

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

  test('reads an explicit Codex goal from the successful goal tool result', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal',
          input: 'const result = await tools.create_goal({objective:"Ship reliable goal detection."}); text(result);',
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal',
          output: [
            { type: 'input_text', text: 'Script completed\nWall time 0.0 seconds\nOutput:\n' },
            {
              type: 'input_text',
              text: JSON.stringify({
                goal: {
                  threadId: 'thread-1',
                  objective: 'Ship reliable goal detection.',
                  status: 'active',
                  tokensUsed: 42,
                  timeUsedSeconds: 3,
                  createdAt: 1_786_012_800,
                  updatedAt: 1_786_012_803,
                },
              }),
            },
          ],
        },
      }),
    ])

    expect(result.goal).toEqual({
      objective: 'Ship reliable goal detection.',
      status: 'active',
    })
  })

  test('reads a goal result emitted through JSON.stringify', () => {
    const result = parseRolloutLines([
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal',
          input: 'const result = await tools.get_goal({}); text(JSON.stringify(result, null, 2));',
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal',
          output: [{
            type: 'input_text',
            text: JSON.stringify({
              goal: { objective: 'Keep observed goal forms compatible.', status: 'active' },
            }),
          }],
        },
      }),
    ])

    expect(result.goal).toEqual({
      objective: 'Keep observed goal forms compatible.',
      status: 'active',
    })
  })

  test('reads a directly emitted goal result when JavaScript uses automatic semicolon insertion', () => {
    const result = parseRolloutLines([
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal-without-semicolons',
          input: [
            'const result = await tools.create_goal({objective:"Accept ordinary JavaScript."})',
            'text(result)',
          ].join('\n'),
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal-without-semicolons',
          output: [{ type: 'input_text', text: JSON.stringify({
            goal: { objective: 'Accept ordinary JavaScript.', status: 'active' },
          }) }],
        },
      }),
    ])

    expect(result.goal).toEqual({ objective: 'Accept ordinary JavaScript.', status: 'active' })
  })

  test('reads a directly emitted goal result after an earlier progress message', () => {
    const result = parseRolloutLines([
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal-after-message',
          input: [
            'text("Creating the goal")',
            'const result = await tools.create_goal({objective:"Keep progress output compatible."});',
            'text(result);',
          ].join('\n'),
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal-after-message',
          output: [
            { type: 'input_text', text: 'Creating the goal' },
            { type: 'input_text', text: JSON.stringify({
              goal: { objective: 'Keep progress output compatible.', status: 'active' },
            }) },
          ],
        },
      }),
    ])

    expect(result.goal).toEqual({ objective: 'Keep progress output compatible.', status: 'active' })
  })

  test('reads a directly emitted goal result after structured progress output', () => {
    const result = parseRolloutLines([
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal-after-structured-progress',
          input: [
            'text({phase:"creating"})',
            'const result = await tools.create_goal({objective:"Ignore structured progress."});',
            'text(result);',
          ].join('\n'),
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal-after-structured-progress',
          output: [
            { type: 'input_text', text: JSON.stringify({ phase: 'creating' }) },
            { type: 'input_text', text: JSON.stringify({
              goal: { objective: 'Ignore structured progress.', status: 'active' },
            }) },
          ],
        },
      }),
    ])

    expect(result.goal).toEqual({ objective: 'Ignore structured progress.', status: 'active' })
  })

  test('keeps the current goal across turns and accepts later goal status results', () => {
    const goalResult = (callId: string, objective: string, status: string) => [
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: callId,
          input: status === 'active'
            ? `const result = await tools.create_goal({objective:${JSON.stringify(objective)}}); text(result);`
            : `const result = await tools.update_goal({status:${JSON.stringify(status)}}); text(result);`,
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: callId,
          output: [{ type: 'input_text', text: JSON.stringify({ goal: { objective, status } }) }],
        },
      }),
    ]
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      ...goalResult('call-create', 'Finish the feature.', 'active'),
      line({ timestamp: '2026-08-06T12:10:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:11:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } }),
      ...goalResult('call-block', 'Finish the feature.', 'blocked'),
    ])

    expect(result.goal).toEqual({ objective: 'Finish the feature.', status: 'blocked' })
  })

  test('does not treat a quoted goal-call example and its diagnostic output as a goal event', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-diagnostic',
          input: 'const example = \'tools.create_goal({objective:"Not real"})\'; text(example);',
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-diagnostic',
          output: [{
            type: 'input_text',
            text: JSON.stringify({ goal: { objective: 'Not real', status: 'active' } }),
          }],
        },
      }),
    ])

    expect(result.goal).toBeNull()
  })

  test('ignores later fabricated goal JSON after the direct goal result', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal-with-diagnostic',
          input: [
            'const result = await tools.get_goal({});',
            'text(result);',
            'text({goal:{objective:"Fabricated diagnostic",status:"active"}});',
          ].join('\n'),
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal-with-diagnostic',
          output: [
            { type: 'input_text', text: JSON.stringify({
              goal: { objective: 'Real current goal.', status: 'blocked' },
            }) },
            { type: 'input_text', text: JSON.stringify({
              goal: { objective: 'Fabricated diagnostic', status: 'active' },
            }) },
          ],
        },
      }),
    ])

    expect(result.goal).toEqual({ objective: 'Real current goal.', status: 'blocked' })
  })

  test('ignores an earlier goal-shaped diagnostic before the direct goal result', () => {
    const result = parseRolloutLines([
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal-after-diagnostic',
          input: [
            'text({goal:{objective:"Diagnostic",status:"active"}});',
            'const result = await tools.get_goal({});',
            'text(result);',
          ].join('\n'),
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal-after-diagnostic',
          output: [
            { type: 'input_text', text: JSON.stringify({
              goal: { objective: 'Diagnostic', status: 'active' },
            }) },
            { type: 'input_text', text: JSON.stringify({
              goal: { objective: 'Real current goal.', status: 'blocked' },
            }) },
          ],
        },
      }),
    ])

    expect(result.goal).toEqual({ objective: 'Real current goal.', status: 'blocked' })
  })

  test('requires the goal tool result itself to be emitted', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({
        timestamp: '2026-08-06T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-goal-without-direct-result',
          input: [
            'await tools.get_goal({});',
            'text({goal:{objective:"Fabricated diagnostic",status:"active"}});',
          ].join('\n'),
        },
      }),
      line({
        timestamp: '2026-08-06T12:00:01.100Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-goal-without-direct-result',
          output: [{ type: 'input_text', text: JSON.stringify({
            goal: { objective: 'Fabricated diagnostic', status: 'active' },
          }) }],
        },
      }),
    ])

    expect(result.goal).toBeNull()
  })

  test('marks a completed turn as ended until the thread is resumed', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-06T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
      line({ timestamp: '2026-08-06T12:10:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }),
    ])

    expect(result.activity).toBe('ended')
    expect(result.endedAt).toBe('2026-08-06T12:10:00.000Z')
    expect(result.turnOutcome).toBe('completed')
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

  test('recognises an explicit wrapup invocation from current Codex user response items', () => {
    const result = parseRolloutLines([
      line({ timestamp: '2026-08-27T14:48:45.691Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-wrapup' } }),
      line({
        timestamp: '2026-08-27T14:48:45.914Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Thanks for the fixes, $wrapup pls' }],
        },
      }),
      line({ timestamp: '2026-08-27T15:18:16.265Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-wrapup' } }),
    ])

    expect(result.stageHint).toBe('wrapping-up')
    expect(result.turnOutcome).toBe('completed')
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

  test('does not treat a negated trailing wrapup command as an invocation', () => {
    const snapshot = parseRolloutLines([
      line({ timestamp: '2026-08-27T14:48:45.691Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-negated-wrapup' } }),
      line({
        timestamp: '2026-08-27T14:48:45.914Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Please do not run $wrapup pls' }],
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
