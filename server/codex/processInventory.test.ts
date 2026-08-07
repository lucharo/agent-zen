import { expect, test } from 'bun:test'
import { parseActiveCodexThreadIds } from './processInventory'

test('extracts every rollout held open by a live Codex process', () => {
  const output = [
    'p9465',
    'ccodex',
    'n/Users/luis/.codex/state_5.sqlite',
    'n/Users/luis/.codex/sessions/2026/08/03/rollout-2026-08-03T13-00-45-019fc77f-6c8e-7260-81a2-29eb2011975f.jsonl',
    'p31472',
    'cCodex',
    'n/Users/luis/.codex/sessions/2026/08/04/rollout-2026-08-04T18-01-50-019fcdb9-72da-7da2-9ba9-892c9f280a46.jsonl',
    'p25513',
    'ccodex',
    'n/Users/luis/.codex/sessions/2026/08/03/rollout-2026-08-03T14-58-36-019fc7eb-5427-75b2-abe2-8930bd4b5c69.jsonl',
    'n/Users/luis/.codex/sessions/2026/08/07/rollout-2026-08-07T14-50-40-019fdc7d-82ac-7952-aecb-11769f74b1a2.jsonl',
    'p77264',
    'ccodex-aarch64-apple-darwin',
    'n/Users/luis/.codex/sessions/2026/08/07/rollout-2026-08-07T15-27-01-019fdc9e-c7df-7412-aaa1-b7060571e5b0.jsonl',
  ].join('\n')

  expect([...(parseActiveCodexThreadIds(output) ?? [])]).toEqual([
    '019fc77f-6c8e-7260-81a2-29eb2011975f',
    '019fc7eb-5427-75b2-abe2-8930bd4b5c69',
    '019fcdb9-72da-7da2-9ba9-892c9f280a46',
    '019fdc7d-82ac-7952-aecb-11769f74b1a2',
    '019fdc9e-c7df-7412-aaa1-b7060571e5b0',
  ])
})

test('rejects non-empty lsof output that contains no recognisable Codex process record', () => {
  expect(parseActiveCodexThreadIds('p123\ncunexpected\nn/some/file')).toBeNull()
})
