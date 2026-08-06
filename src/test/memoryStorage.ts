/**
 * A real `Storage` implementation backed by a Map.
 *
 * happy-dom under Node 26 leaves `window.localStorage` undefined, so the app's
 * persistence path would silently no-op in tests and every "survives a reload"
 * assertion would pass vacuously. This gives it something to actually write to.
 */
export function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()

  return {
    get length() {
      return entries.size
    },
    key(index: number) {
      return [...entries.keys()][index] ?? null
    },
    getItem(key: string) {
      return entries.get(key) ?? null
    },
    setItem(key: string, value: string) {
      entries.set(key, String(value))
    },
    removeItem(key: string) {
      entries.delete(key)
    },
    clear() {
      entries.clear()
    },
  }
}
