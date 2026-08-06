export type RequestPolicyResult =
  | { readonly allowed: true; readonly corsHeaders: Readonly<Record<string, string>> }
  | {
      readonly allowed: false
      readonly status: 403
      readonly reason: 'untrusted-host' | 'untrusted-origin'
    }

/** Validate the browser boundary on every route, including read-only routes. */
export function localRequestPolicy(
  request: Request,
  bridgePort: number,
  additionalOrigins: readonly string[] = [],
): RequestPolicyResult {
  const url = new URL(request.url)
  const host = request.headers.get('host') ?? url.host
  const trustedHosts = new Set([
    `127.0.0.1:${bridgePort}`,
    `localhost:${bridgePort}`,
  ])
  if (!trustedHosts.has(host)) {
    return { allowed: false, status: 403, reason: 'untrusted-host' }
  }

  const origin = request.headers.get('origin')
  const trustedOrigins = new Set([
    `http://127.0.0.1:${bridgePort}`,
    `http://localhost:${bridgePort}`,
    ...additionalOrigins.filter(isLoopbackOrigin),
  ])
  if (origin && !trustedOrigins.has(origin)) {
    return { allowed: false, status: 403, reason: 'untrusted-origin' }
  }

  const allowedOrigin = origin && trustedOrigins.has(origin) ? origin : `http://127.0.0.1:${bridgePort}`
  return {
    allowed: true,
    corsHeaders: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  }
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}
