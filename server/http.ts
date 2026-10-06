import { extname, join, normalize, resolve } from 'node:path'
import type { AgentZenBridgeService } from './bridgeService'
import { FocusLimitReachedError, ReadOnlySessionError } from './bridgeService'
import { normaliseUiPreferences } from '../src/domain/preferences'
import { BRIDGE_MUTATION_PATH } from '../src/bridge/types'
import { localRequestPolicy } from './security'

export interface BridgeRequestHandlerOptions {
  readonly service: AgentZenBridgeService
  readonly port: number
  readonly distDirectory: string
  readonly allowedOrigins?: readonly string[]
  readonly runtime?: { readonly pid: number; readonly version: string }
  readonly frontendBuildId?: string
  readonly frontendApiPort?: number
}

export interface FrontendProxyRequestHandlerOptions {
  readonly port: number
  readonly distDirectory: string
  readonly upstreamBaseUrl: string
  readonly frontendBuildId: string
  readonly fetchUpstream?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

export function createBridgeRequestHandler(options: BridgeRequestHandlerOptions) {
  let snapshotInFlight: ReturnType<AgentZenBridgeService['snapshot']> | null = null
  const readSnapshot = (): ReturnType<AgentZenBridgeService['snapshot']> => {
    if (snapshotInFlight) return snapshotInFlight
    const nextSnapshot = options.service.snapshot()
    snapshotInFlight = nextSnapshot
    const clear = () => {
      if (snapshotInFlight === nextSnapshot) snapshotInFlight = null
    }
    void nextSnapshot.then(clear, clear)
    return nextSnapshot
  }

  return async (request: Request): Promise<Response> => {
    const policy = localRequestPolicy(request, options.port, options.allowedOrigins)
    if (!policy.allowed) return json({ error: policy.reason }, policy.status)
    const headers = policy.corsHeaders
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    const url = new URL(request.url)
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({
          ...options.service.health(),
          runtime: options.runtime,
          frontendBuildId: options.frontendBuildId,
          frontendApiPort: options.frontendApiPort,
        }, 200, headers)
      }
      if (url.pathname === '/api/snapshot' && request.method === 'GET') {
        return json(await readSnapshot(), 200, headers)
      }
      if (url.pathname === `${BRIDGE_MUTATION_PATH}/settings/focus` && request.method === 'PUT') {
        const body = await bodyObject(request)
        return json(
          await options.service.setFocus(body.enabled === true, numberValue(body.limit, 3)),
          200,
          headers,
        )
      }
      if (url.pathname === `${BRIDGE_MUTATION_PATH}/settings/preferences` && request.method === 'PUT') {
        const preferences = normaliseUiPreferences(await bodyObject(request))
        if (!preferences) throw new RequestError('UI preferences are required.')
        return json(await options.service.setPreferences(preferences), 200, headers)
      }
      if (url.pathname === `${BRIDGE_MUTATION_PATH}/projects/register` && request.method === 'POST') {
        const body = await bodyObject(request)
        const candidateIds = Array.isArray(body.candidateIds)
          ? body.candidateIds.filter((value): value is string => typeof value === 'string')
          : []
        return json(await options.service.registerProjects(candidateIds), 200, headers)
      }
      if (url.pathname === `${BRIDGE_MUTATION_PATH}/sessions/launch` && request.method === 'POST') {
        const body = await bodyObject(request)
        if (typeof body.projectId !== 'string' || typeof body.prompt !== 'string') {
          throw new RequestError('projectId and prompt are required.')
        }
        return json(
          await options.service.launch({
            projectId: body.projectId,
            prompt: body.prompt,
            model: typeof body.model === 'string' ? body.model : null,
            effort: typeof body.effort === 'string' ? body.effort : null,
          }),
          201,
          headers,
        )
      }

      const control = url.pathname.match(
        new RegExp(`^${BRIDGE_MUTATION_PATH}/sessions/([^/]+)/(interrupt|steer|respond)$`),
      )
      if (control && request.method === 'POST') {
        const threadId = decodeURIComponent(control[1] ?? '')
        if (control[2] === 'interrupt') {
          await options.service.interrupt(threadId)
        } else if (control[2] === 'steer') {
          const body = await bodyObject(request)
          if (typeof body.prompt !== 'string') throw new RequestError('prompt is required.')
          await options.service.steer(threadId, body.prompt)
        } else {
          const body = await bodyObject(request)
          if (typeof body.requestId !== 'string' && typeof body.requestId !== 'number') {
            throw new RequestError('requestId is required.')
          }
          if (body.kind === 'user-input') {
            if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
              throw new RequestError('answers are required.')
            }
            const answers = Object.fromEntries(
              Object.entries(body.answers).map(([id, value]) => [
                id,
                Array.isArray(value)
                  ? value.filter((answer): answer is string => typeof answer === 'string')
                  : [],
              ]),
            )
            await options.service.respond(threadId, {
              requestId: body.requestId,
              kind: 'user-input',
              answers,
            })
          } else if (
            body.kind === 'approval' &&
            (body.decision === 'accept' || body.decision === 'acceptForSession' ||
              body.decision === 'decline' || body.decision === 'cancel')
          ) {
            await options.service.respond(threadId, {
              requestId: body.requestId,
              kind: 'approval',
              decision: body.decision,
            })
          } else if (
            body.kind === 'permissions' &&
            (body.scope === 'turn' || body.scope === 'session')
          ) {
            await options.service.respond(threadId, {
              requestId: body.requestId,
              kind: 'permissions',
              scope: body.scope,
            })
          } else {
            throw new RequestError('A supported response is required.')
          }
        }
        return json({ ok: true }, 200, headers)
      }

      if (url.pathname.startsWith('/api/')) return json({ error: 'not-found' }, 404, headers)
      return staticResponse(url.pathname, options.distDirectory, headers)
    } catch (error) {
      if (error instanceof FocusLimitReachedError) {
        return json({ error: 'focus-limit-reached', message: error.message }, 409, headers)
      }
      if (error instanceof ReadOnlySessionError) {
        return json({ error: 'read-only-session', message: error.message }, 409, headers)
      }
      if (error instanceof RequestError) return json({ error: error.message }, 400, headers)
      return json(
        { error: error instanceof Error ? error.message : 'Bridge request failed.' },
        500,
        headers,
      )
    }
  }
}

export function createFrontendProxyRequestHandler(options: FrontendProxyRequestHandlerOptions) {
  const fetchUpstream = options.fetchUpstream ?? fetch
  return async (request: Request): Promise<Response> => {
    const policy = localRequestPolicy(request, options.port)
    if (!policy.allowed) return json({ error: policy.reason }, policy.status)
    const headers = policy.corsHeaders
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      return staticResponse(url.pathname, options.distDirectory, headers)
    }

    try {
      const upstreamUrl = new URL(`${url.pathname}${url.search}`, options.upstreamBaseUrl)
      const forwardedHeaders = new Headers()
      for (const name of ['accept', 'content-type']) {
        const value = request.headers.get(name)
        if (value) forwardedHeaders.set(name, value)
      }
      let body: ArrayBuffer | undefined
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.arrayBuffer()
        if (body.byteLength > 64 * 1024) return json({ error: 'Request body is too large.' }, 413)
      }
      const upstream = await fetchUpstream(upstreamUrl, {
        method: request.method,
        headers: forwardedHeaders,
        body,
        cache: 'no-store',
      })
      if (url.pathname === '/api/health' && request.method === 'GET') {
        const health = await upstream.json().catch(() => null)
        if (!health || typeof health !== 'object' || Array.isArray(health)) {
          return json({ error: 'invalid-upstream-health' }, 502, headers)
        }
        return json({
          ...health,
          frontendBuildId: options.frontendBuildId,
          frontendApiPort: Number(new URL(options.upstreamBaseUrl).port),
        }, upstream.status, headers)
      }
      const responseHeaders = new Headers(upstream.headers)
      responseHeaders.set('Cache-Control', 'no-store')
      for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value)
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      })
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : 'Agent Zen daemon proxy failed.',
      }, 502, headers)
    }
  }
}

class RequestError extends Error {}

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > 64 * 1024) throw new RequestError('Request body is too large.')
  const value = await request.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError('A JSON object is required.')
  }
  return value as Record<string, unknown>
}

async function staticResponse(
  pathname: string,
  distDirectory: string,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  const root = resolve(distDirectory)
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const filePath = resolve(root, normalize(requested))
  if (!filePath.startsWith(`${root}/`) && filePath !== root) return json({ error: 'not-found' }, 404, headers)
  let servedPath = filePath
  let file = Bun.file(servedPath)
  if (!(await file.exists())) {
    servedPath = join(root, 'index.html')
    file = Bun.file(servedPath)
  }
  if (!(await file.exists())) return json({ error: 'build-not-found' }, 404, headers)
  return new Response(file, {
    headers: {
      ...headers,
      'Content-Type': contentType(servedPath),
      'Cache-Control': servedPath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    },
  })
}

function json(
  value: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function contentType(filePath: string): string {
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    }[extname(filePath)] ?? 'application/octet-stream'
  )
}
