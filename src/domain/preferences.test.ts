import { describe, expect, test } from 'vitest'
import { DEFAULT_UI_PREFERENCES, normaliseUiPreferences, normaliseVisibleAgents } from './preferences'
import { reducer } from '@/state/reducer'
import { createInitialState } from '@/state/persistence'

describe('visible agents preference', () => {
  test('defaults to every agent and drops unknown or empty selections', () => {
    expect(normaliseVisibleAgents(undefined)).toEqual(['codex', 'claude'])
    expect(normaliseVisibleAgents([])).toEqual(['codex', 'claude'])
    expect(normaliseVisibleAgents(['gemini'])).toEqual(['codex', 'claude'])
    expect(normaliseVisibleAgents(['claude', 'gemini', 'claude'])).toEqual(['claude'])
    expect(normaliseUiPreferences({ visibleAgents: ['claude'] })).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      visibleAgents: ['claude'],
    })
  })

  test('the reducer toggles an agent but never hides the last one', () => {
    const initial = createInitialState(0)
    const codexOnly = reducer(initial, { type: 'toggle-agent-visibility', agent: 'claude' })
    expect(codexOnly.visibleAgents).toEqual(['codex'])
    expect(reducer(codexOnly, { type: 'toggle-agent-visibility', agent: 'codex' })).toBe(codexOnly)
    expect(reducer(codexOnly, { type: 'toggle-agent-visibility', agent: 'claude' }).visibleAgents).toEqual([
      'codex',
      'claude',
    ])
  })
})
