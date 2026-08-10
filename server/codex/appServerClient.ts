export interface AppServerNotification {
  readonly id?: number | string
  readonly method: string
  readonly params?: unknown
}

export interface CodexAppServerClientOptions {
  readonly command?: readonly string[]
  readonly requestTimeoutMs?: number
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface RpcMessage {
  readonly id?: number | string
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown }
}

const MAX_BUFFER_CHARACTERS = 16 * 1024 * 1024

/** JSONL stdio client for the bundled `codex app-server`. */
export class CodexAppServerClient {
  private readonly command: readonly string[]
  private readonly requestTimeoutMs: number
  private process: ReturnType<typeof Bun.spawn> | null = null
  private pending = new Map<number, PendingRequest>()
  private listeners = new Set<(notification: AppServerNotification) => void>()
  private nextId = 1
  private generation = 0
  private connectPromise: Promise<Record<string, unknown>> | null = null
  private initialized: Record<string, unknown> | null = null

  constructor(options: CodexAppServerClientOptions = {}) {
    this.command = options.command ?? ['codex', 'app-server', '--stdio']
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000
  }

  connect(): Promise<Record<string, unknown>> {
    if (this.initialized) return Promise.resolve(this.initialized)
    if (this.connectPromise) return this.connectPromise
    const attempt = this.start()
    this.connectPromise = attempt
    void attempt.catch(() => {
      if (this.connectPromise === attempt) this.connectPromise = null
    })
    return attempt
  }

  subscribe(listener: (notification: AppServerNotification) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get isConnected(): boolean {
    return this.process !== null && this.initialized !== null
  }

  get connectionGeneration(): number {
    return this.generation
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    await this.connect()
    return this.sendRequest<T>(method, params)
  }

  async respond(id: number | string, result: unknown): Promise<void> {
    await this.connect()
    this.write({ id, result })
  }

  async close(): Promise<void> {
    const process = this.process
    this.process = null
    this.initialized = null
    this.connectPromise = null
    if (!process) return
    try {
      const input = process.stdin
      if (input && typeof input !== 'number') input.end()
    } catch {
      // The child may already have closed its input.
    }
    const exited = await Promise.race([
      process.exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ])
    if (exited === null) process.kill()
    this.rejectPending(new Error('Codex app-server closed.'))
  }

  private async start(): Promise<Record<string, unknown>> {
    this.generation += 1
    let process: ReturnType<typeof Bun.spawn> | null = null
    try {
      const spawned = Bun.spawn([...this.command], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      process = spawned
      this.process = spawned
      void this.readStdout(spawned.stdout)
      void this.drainStderr(spawned.stderr)
      void spawned.exited.then((code) => {
        if (this.process !== spawned) return
        this.process = null
        this.initialized = null
        this.connectPromise = null
        this.rejectPending(new Error(`Codex app-server exited with code ${code}.`))
      })

      const result = await this.sendRequest<Record<string, unknown>>('initialize', {
        clientInfo: { name: 'agent-zen', title: 'Agent Zen', version: '0.1.0' },
        capabilities: { experimentalApi: false, requestAttestation: false },
      })
      this.sendNotification('initialized')
      this.initialized = result
      return result
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (process && this.process === process) this.abortStartup(process, failure)
      throw failure
    }
  }

  private abortStartup(process: ReturnType<typeof Bun.spawn>, error: Error): void {
    this.process = null
    this.initialized = null
    this.connectPromise = null
    try {
      const input = process.stdin
      if (input && typeof input !== 'number') input.end()
    } catch {
      // The failed child may already have closed its input.
    }
    try {
      process.kill()
    } catch {
      // A child that exited during initialization needs no further cleanup.
    }
    this.rejectPending(error)
  }

  private sendRequest<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, this.requestTimeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      try {
        this.write({ id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private sendNotification(method: string): void {
    this.write({ method })
  }

  private write(message: RpcMessage): void {
    const process = this.process
    if (!process) throw new Error('Codex app-server is not running.')
    const input = process.stdin
    if (!input || typeof input === 'number') throw new Error('Codex app-server input is unavailable.')
    input.write(`${JSON.stringify(message)}\n`)
    input.flush()
  }

  private async readStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    const reader = stream.getReader()
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value
      buffer += decoder.decode(chunk, { stream: true })
      if (buffer.length > MAX_BUFFER_CHARACTERS) {
        this.rejectPending(new Error('Codex app-server emitted an oversized JSONL message.'))
        buffer = ''
        continue
      }
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) this.handleLine(line)
        newline = buffer.indexOf('\n')
      }
    }
  }

  private handleLine(line: string): void {
    let message: RpcMessage
    try {
      message = JSON.parse(line) as RpcMessage
    } catch {
      return
    }
    if (message.method) {
      const notification = { id: message.id, method: message.method, params: message.params }
      for (const listener of this.listeners) listener(notification)
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Codex app-server request failed.'))
      } else {
        pending.resolve(message.result)
      }
      return
    }
  }

  private async drainStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    while (!(await reader.read()).done) {
      // Drain the pipe. App-server diagnostics stay out of the browser contract.
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
