import { describe, expect, it } from 'vitest'
import { resolveBridgeBaseUrl } from './httpBridge'

describe('resolveBridgeBaseUrl', () => {
  it('uses an explicit configured bridge', () => {
    expect(resolveBridgeBaseUrl('http://127.0.0.1:9000', null, true)).toBe('http://127.0.0.1:9000')
  })

  it('keeps Vite development on any port pointed at the standard bridge', () => {
    expect(resolveBridgeBaseUrl(undefined, { origin: 'http://127.0.0.1:5280', port: '5280' }, true))
      .toBe('http://127.0.0.1:5274')
  })

  it('uses the serving origin in a packaged app', () => {
    expect(resolveBridgeBaseUrl(undefined, { origin: 'http://127.0.0.1:5275', port: '5275' }, false))
      .toBe('http://127.0.0.1:5275')
  })
})
