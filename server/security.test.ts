import { describe, expect, test } from 'bun:test'
import { localRequestPolicy } from './security'

describe('localRequestPolicy', () => {
  test('accepts loopback hosts and an explicitly allowed development app origin', () => {
    const request = new Request('http://127.0.0.1:5274/api/snapshot', {
      headers: { host: '127.0.0.1:5274', origin: 'http://127.0.0.1:5273' },
    })
    expect(localRequestPolicy(request, 5274, ['http://127.0.0.1:5273']))
      .toMatchObject({ allowed: true })
  })

  test('does not trust the development port unless this bridge explicitly allows it', () => {
    const request = new Request('http://127.0.0.1:5275/api/snapshot', {
      headers: { host: '127.0.0.1:5275', origin: 'http://127.0.0.1:5273' },
    })
    expect(localRequestPolicy(request, 5275)).toEqual({
      allowed: false,
      status: 403,
      reason: 'untrusted-origin',
    })
  })

  test('accepts an explicitly configured loopback app origin', () => {
    const request = new Request('http://127.0.0.1:5276/api/snapshot', {
      headers: { host: '127.0.0.1:5276', origin: 'http://127.0.0.1:5277' },
    })
    expect(localRequestPolicy(request, 5276, ['http://127.0.0.1:5277']))
      .toMatchObject({ allowed: true })
  })

  test('does not trust a non-loopback origin supplied as configuration', () => {
    const request = new Request('http://127.0.0.1:5274/api/snapshot', {
      headers: { host: '127.0.0.1:5274', origin: 'https://evil.example' },
    })
    expect(localRequestPolicy(request, 5274, ['https://evil.example'])).toEqual({
      allowed: false,
      status: 403,
      reason: 'untrusted-origin',
    })
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
    const request = new Request('http://127.0.0.1:5274/api/v7/settings/focus', {
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
