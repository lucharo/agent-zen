import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('application metadata', () => {
  it('ships a favicon instead of relying on the browser default', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const favicon = readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8')

    expect(html).toContain('<link rel="icon" href="/favicon.svg"')
    expect(favicon).toContain('<svg')
    expect(favicon).toContain('aria-hidden="true"')
  })
})
