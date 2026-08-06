import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createMemoryStorage } from './src/test/memoryStorage'

// happy-dom under Node 26 does not expose a working `localStorage`, so install
// one before anything reads it. Without this the app's persistence is a no-op
// under test and reload assertions would pass without proving anything.
beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  })
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    value: TestResizeObserver,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: TestResizeObserver,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  window.localStorage?.clear()
})
