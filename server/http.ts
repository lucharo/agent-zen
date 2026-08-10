import { extname, join, normalize, resolve } from 'node:path'
import type { AgentZenBridgeService } from './bridgeService'
import { FocusLimitReachedError } from './bridgeService'
import { normaliseUiPreferences } from '../src/domain/preferences'
import { localRequestPolicy } from './security'

export interface BridgeRequestHandlerOptions {
  readonly service: AgentZenBridgeService
  readonly port: number
  readonly distDirectory: string
  readonly allowedOrigins?: readonly string[]
  readonly runtime?: { readonly pid: number; readonly version: string }
}

export function createBridgeRequestHandler(options: BridgeRequestHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    const policy = localRequestPolicy(request, options.port, options.allowedOrigins)
    if (!policy.allowed) return json({ error: policy.reason }, policy.status)
    const headers = policy.corsHeaders
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    const url = new URL(request.url)
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ...options.service.health(), runtime: options.runtime }, 200, headers)
      }
      if (url.pathname === '/api/snapshot' && request.method === 'GET') {
        return json(await options.service.snapshot(), 200, headers)
      }
      if (url.pathname === '/api/v4/settings/focus' && request.method === 'PUT') {
        const body = await bodyObject(request)
        return json(
          await options.service.setFocus(body.enabled === true, numberValue(body.limit, 3)),
          200,
          headers,
        )
      }
      if (url.pathname === '/api/v4/settings/preferences' && request.method === 'PUT') {
        const preferences = normaliseUiPreferences(await bodyObject(request))
        if (!preferences) throw new RequestError('UI preferences are required.')
        return json(await options.service.setPreferences(preferences), 200, headers)
      }
      if (url.pathname === '/api/v4/projects/register' && request.method === 'POST') {
        const body = await bodyObject(request)
        const candidateIds = Array.isArray(body.candidateIds)
          ? body.candidateIds.filter((value): value is string => typeof value === 'string')
          : []
        return json(await options.service.registerProjects(candidateIds), 200, headers)
      }
      if (url.pathname === '/api/v4/sessions/launch' && request.method === 'POST') {
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

      const control = url.pathname.match(/^\/api\/v4\/sessions\/([^/]+)\/(interrupt|steer)$/)
      if (control && request.method === 'POST') {
        const threadId = decodeURIComponent(control[1] ?? '')
        if (control[2] === 'interrupt') {
          await options.service.interrupt(threadId)
        } else {
          const body = await bodyObject(request)
          if (typeof body.prompt !== 'string') throw new RequestError('prompt is required.')
          await options.service.steer(threadId, body.prompt)
        }
        return json({ ok: true }, 200, headers)
      }

      if (url.pathname.startsWith('/api/')) return json({ error: 'not-found' }, 404, headers)
      return staticResponse(url.pathname, options.distDirectory, headers)
    } catch (error) {
      if (error instanceof FocusLimitReachedError) {
        return json({ error: 'focus-limit-reached', message: error.message }, 409, headers)
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
