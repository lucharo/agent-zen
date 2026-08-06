import { createInterface } from 'node:readline'

// Keep stdin open and deliberately never answer initialize requests.
createInterface({ input: process.stdin }).on('line', () => undefined)
