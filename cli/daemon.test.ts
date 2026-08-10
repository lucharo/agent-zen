import { describe, expect, test } from 'bun:test'
import {
  canReuseHealthyDaemon,
  DAEMON_LABEL,
  defaultDaemonPaths,
  hasManagedDaemonStopped,
  isLaunchAtLoginConfigured,
  parseDaemonHealth,
  parseLaunchAtLoginEnabled,
  parseLogLineCount,
  parseLaunchctlPrint,
  renderLaunchAgent,
  waitUntil,
} from './daemon'

describe('Agent Zen daemon contract', () => {
  test('places installed assets beneath the CLI prefix and state beneath home', () => {
    expect(defaultDaemonPaths({
      home: '/Users/tester',
      executablePath: '/Users/tester/.local/bin/agent-zen',
    })).toEqual({
      cliPath: '/Users/tester/.local/bin/agent-zen',
      serverPath: '/Users/tester/.local/libexec/agent-zen/agent-zen-server',
      distDirectory: '/Users/tester/.local/share/agent-zen/dist',
      dataDirectory: '/Users/tester/.agent-zen',
      logPath: '/Users/tester/.agent-zen/daemon.log',
      plistPath: '/Users/tester/Library/LaunchAgents/io.lucharo.agent-zen.plist',
    })
  })

  test('renders a launch-at-login service with explicit local paths', () => {
    const paths = defaultDaemonPaths({
      home: '/Users/tester',
      executablePath: '/Users/tester/.local/bin/agent-zen',
    })
    const plist = renderLaunchAgent(paths, {
      codexPath: '/Users/tester/.local/bin/codex',
      port: 5274,
      path: '/Users/tester/.local/bin:/usr/bin:/bin',
    })

    expect(plist).toContain(`<string>${DAEMON_LABEL}</string>`)
    expect(plist).toContain('<key>KeepAlive</key>\n  <true/>')
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(plist).toContain('<string>/Users/tester/.local/libexec/agent-zen/agent-zen-server</string>')
    expect(plist).toContain('<key>AGENT_ZEN_DIST_DIR</key>')
    expect(plist).toContain('<string>/Users/tester/.local/share/agent-zen/dist</string>')
    expect(plist).toContain('<key>AGENT_ZEN_CODEX_PATH</key>')
    expect(plist).toContain('<string>/Users/tester/.local/bin/codex</string>')
  })

  test('escapes generated plist values', () => {
    const paths = defaultDaemonPaths({
      home: '/Users/test & co',
      executablePath: '/Users/test & co/.local/bin/agent-zen',
    })
    expect(renderLaunchAgent(paths, {
      codexPath: '/Applications/Codex & Friends/codex',
      port: 5274,
      path: '/usr/bin:/bin',
    })).toContain('/Users/test &amp; co')
  })

  test('reads launchd state and pid without treating an unloaded service as running', () => {
    expect(parseLaunchctlPrint(`state = running\npid = 4217\n`)).toEqual({
      loaded: true,
      state: 'running',
      pid: 4217,
    })
    expect(parseLaunchctlPrint('', false)).toEqual({ loaded: false, state: null, pid: null })
  })

  test('checks once more after sleeping across the deadline', async () => {
    let now = 0
    let checks = 0
    await waitUntil(
      async () => {
        checks += 1
        return checks === 3
      },
      {
        timeoutMs: 5_000,
        intervalMs: 4_000,
        message: 'should not time out',
        now: () => now,
        sleep: async (milliseconds) => { now += milliseconds },
      },
    )
    expect(checks).toBe(3)
  })

  test('does not call a daemon stopped while its old pid still serves HTTP', () => {
    expect(hasManagedDaemonStopped(
      { loaded: false, state: null, pid: null },
      { reachable: true, pid: 4217, version: '0.1.0', codexConnected: true },
      4217,
    )).toBe(false)
    expect(hasManagedDaemonStopped(
      { loaded: false, state: null, pid: null },
      { reachable: false, pid: null, version: null, codexConnected: false },
      4217,
    )).toBe(true)
    expect(hasManagedDaemonStopped(
      { loaded: false, state: null, pid: null },
      { reachable: true, pid: 9001, version: '0.1.0', codexConnected: true },
      4217,
    )).toBe(true)
  })

  test('authenticates HTTP health with the serving process id', () => {
    expect(parseDaemonHealth({
      connection: { connected: false },
      generatedAt: '2026-08-10T13:00:00.000Z',
      runtime: { pid: 4217, version: '0.1.0' },
    })).toEqual({ reachable: true, pid: 4217, version: '0.1.0', codexConnected: false })
    expect(parseDaemonHealth({ connection: { connected: true } })).toEqual({
      reachable: false,
      pid: null,
      version: null,
      codexConnected: false,
    })
  })

  test('rejects invalid daemon log line counts', () => {
    expect(parseLogLineCount([])).toBe(80)
    expect(parseLogLineCount(['--lines', '25'])).toBe(25)
    expect(() => parseLogLineCount(['--lines'])).toThrow('requires a positive integer')
    expect(() => parseLogLineCount(['--lines', 'zero'])).toThrow('requires a positive integer')
    expect(() => parseLogLineCount(['--lines', '-2'])).toThrow('requires a positive integer')
  })

  test('reads the launchd disabled override format', () => {
    expect(parseLaunchAtLoginEnabled('"io.lucharo.agent-zen" => enabled', DAEMON_LABEL)).toBe(true)
    expect(parseLaunchAtLoginEnabled('"io.lucharo.agent-zen" => disabled', DAEMON_LABEL)).toBe(false)
  })

  test('repairs persistence for a healthy loaded daemon when its plist is missing or override is disabled', () => {
    const launchd = { loaded: true, state: 'running', pid: 4217 }
    const health = { reachable: true, pid: 4217, version: '0.1.0', codexConnected: true }
    const missingPlist = { plistExists: false, overrideEnabled: true }
    const disabledOverride = { plistExists: true, overrideEnabled: false }
    const configured = { plistExists: true, overrideEnabled: true }

    expect({
      missingPlist: {
        reusable: canReuseHealthyDaemon(launchd, health, missingPlist),
        launchAtLogin: isLaunchAtLoginConfigured(missingPlist),
      },
      disabledOverride: {
        reusable: canReuseHealthyDaemon(launchd, health, disabledOverride),
        launchAtLogin: isLaunchAtLoginConfigured(disabledOverride),
      },
      configured: {
        reusable: canReuseHealthyDaemon(launchd, health, configured),
        launchAtLogin: isLaunchAtLoginConfigured(configured),
      },
    }).toEqual({
      missingPlist: { reusable: false, launchAtLogin: false },
      disabledOverride: { reusable: false, launchAtLogin: false },
      configured: { reusable: true, launchAtLogin: true },
    })
  })
})
