import { describe, expect, test } from 'bun:test'
import { localRequestPolicy } from './security'

describe('localRequestPolicy', () => {
  test('accepts loopback hosts and the development app origin', () => {
    const request = new Request('http://127.0.0.1:5274/api/snapshot', {
      headers: { host: '127.0.0.1:5274', origin: 'http://127.0.0.1:5273' },
    })
    expect(localRequestPolicy(request, 5274)).toMatchObject({ allowed: true })
  })

  test('rejects DNS-rebinding hosts', () => {
    const request = new Request('http://evil.example/api/snapshot', {
      headers: { host: 'evil.example' },
    })
    expect(localRequestPolicy(request, 5274)).toEqual({
      allowed: false,
      status: 403,
      reason: 'untrusted-host',
    })
  })

  test('rejects a browser request from an unrelated origin', () => {
    const request = new Request('http://127.0.0.1:5274/api/settings/focus', {
      method: 'PUT',
      headers: { host: '127.0.0.1:5274', origin: 'https://evil.example' },
    })
    expect(localRequestPolicy(request, 5274)).toEqual({
      allowed: false,
      status: 403,
      reason: 'untrusted-origin',
    })
  })
})
