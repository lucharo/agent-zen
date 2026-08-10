import { createInterface } from 'node:readline'

const input = createInterface({ input: process.stdin })

input.on('line', (raw) => {
  const message = JSON.parse(raw) as { id?: number; method: string }
  if (message.method === 'initialize') {
    respond(message.id, { userAgent: 'fake-codex/1.0', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'macos' })
    notify('turn/plan/updated', {
      threadId: 'thread-owned',
      turnId: 'turn-owned',
      explanation: null,
      plan: [{ step: 'Build bridge', status: 'inProgress' }],
    })
    request(7, 'item/tool/requestUserInput', {
      threadId: 'thread-owned', turnId: 'turn-owned', itemId: 'item-input', isBlocking: true,
    })
  } else if (message.method === 'thread/list') {
    respond(message.id, { data: [], nextCursor: null, backwardsCursor: null })
  } else if (message.method === 'thread/read') {
    respond(message.id, { thread: { id: 'thread-owned', turns: [] } })
  }
})

function respond(id: number | undefined, result: unknown) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`)
}

function notify(method: string, params: unknown) {
  process.stdout.write(`${JSON.stringify({ method, params })}\n`)
}

function request(id: number, method: string, params: unknown) {
  process.stdout.write(`${JSON.stringify({ id, method, params })}\n`)
}
