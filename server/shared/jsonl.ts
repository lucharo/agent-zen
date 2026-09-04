import { open, stat } from 'node:fs/promises'

const REVERSE_SCAN_CHUNK_BYTES = 128 * 1024
const MAX_ANCHOR_LINE_BYTES = 256 * 1024

/** Read the last `maxBytes` of a JSONL file as whole lines (a leading partial line is dropped). */
export async function readTail(filePath: string, maxBytes: number): Promise<string[]> {
  const metadata = await stat(filePath)
  const length = Math.min(metadata.size, maxBytes)
  const start = Math.max(0, metadata.size - length)
  const handle = await open(filePath, 'r')
  try {
    const bytes = Buffer.alloc(length)
    await handle.read(bytes, 0, length, start)
    let text = bytes.toString('utf8')
    if (start > 0) {
      const firstNewline = text.indexOf('\n')
      text = firstNewline === -1 ? '' : text.slice(firstNewline + 1)
    }
    return text.split('\n')
  } finally {
    await handle.close()
  }
}

/** Yield complete JSONL records newest-first without retaining giant tool-output lines. */
export async function* reverseLines(
  filePath: string,
  size: number,
  minimumPosition = 0,
): AsyncGenerator<string> {
  const handle = await open(filePath, 'r')
  let position = size
  let carry = Buffer.alloc(0)
  let skippingOversizedLine = false
  try {
    while (position > minimumPosition) {
      const start = Math.max(minimumPosition, position - REVERSE_SCAN_CHUNK_BYTES)
      const length = position - start
      const bytes = Buffer.allocUnsafe(length)
      await handle.read(bytes, 0, length, start)
      const newlines: number[] = []
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] === 0x0a) newlines.push(index)
      }

      if (newlines.length === 0) {
        if (!skippingOversizedLine) {
          if (bytes.length + carry.length <= MAX_ANCHOR_LINE_BYTES) {
            carry = Buffer.concat([bytes, carry])
          } else {
            carry = Buffer.alloc(0)
            skippingOversizedLine = true
          }
        }
        position = start
        continue
      }

      const lastNewline = newlines[newlines.length - 1]!
      if (!skippingOversizedLine) {
        const suffix = Buffer.concat([bytes.subarray(lastNewline + 1), carry])
        if (suffix.length <= MAX_ANCHOR_LINE_BYTES && suffix.length > 0) {
          yield suffix.toString('utf8')
        }
      }
      for (let index = newlines.length - 1; index > 0; index -= 1) {
        const line = bytes.subarray(newlines[index - 1]! + 1, newlines[index]!)
        if (line.length > 0) yield line.toString('utf8')
      }

      carry = Buffer.from(bytes.subarray(0, newlines[0]!))
      skippingOversizedLine = carry.length > MAX_ANCHOR_LINE_BYTES
      if (skippingOversizedLine) carry = Buffer.alloc(0)
      position = start
    }
    if (!skippingOversizedLine && carry.length > 0) yield carry.toString('utf8')
  } finally {
    await handle.close()
  }
}
