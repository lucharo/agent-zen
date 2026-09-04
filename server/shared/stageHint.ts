/** A workflow stage a human explicitly invoked in their prompt, or null. */
export type StageHint = 'reviewing' | 'wrapping-up' | null

export function stageHintFromMessage(message: string | null): StageHint {
  if (!message) return null
  const request = requestBody(message)
  const line = request.split('\n').map((candidate) => candidate.trim()).find(Boolean) ?? ''
  const semanticLine = line.startsWith('>') ? '' : line.replace(/`[^`]*`/g, '')
  const linked = stageHintFromSkillLink(semanticLine)
  if (linked) return linked
  const wrapupToken = /(?:^|[\s,;:])[\/$]wrapup(?=[\s,.!?;:]|$)/i.exec(semanticLine)
  const wrapupTokenIndex = wrapupToken
    ? wrapupToken.index + wrapupToken[0].search(/[\/$]/)
    : -1
  if (
    /^[\/$]wrapup(?:\s|$)/i.test(semanticLine) ||
    (wrapupToken &&
      !commandTokenIsQuoted(semanticLine, wrapupTokenIndex) &&
      !linkIsDiscussedRatherThanInvoked(
        semanticLine.slice(0, wrapupToken.index).trim(),
      ))
  ) {
    return 'wrapping-up'
  }
  if (
    /^[\/$](?:[a-z0-9]+-)*review(?:-[a-z0-9]+)*(?:\s|$)/i.test(semanticLine) ||
    /^[\/$]webapp-agent-demo(?:\s|$)/i.test(semanticLine)
  ) {
    return 'reviewing'
  }
  return null
}

function stageHintFromSkillLink(line: string): StageHint {
  const links = /\[\s*\$([a-z0-9-]+)\s*\]\(([^)\n]+)\)/gi
  for (const match of line.matchAll(links)) {
    const command = match[1]?.toLowerCase()
    const target = match[2]?.replaceAll('\\', '/').replace(/[?#].*$/, '')
    if (!command || !target || !target.toLowerCase().endsWith(`/${command}/skill.md`)) continue
    const before = line.slice(0, match.index).trim()
    const after = line.slice((match.index ?? 0) + match[0].length).trim()
    if (!/^[.!?,;:)]*$/.test(after) || linkIsDiscussedRatherThanInvoked(before)) continue
    if (command === 'wrapup') return 'wrapping-up'
    if (command === 'webapp-agent-demo' || /(?:^|-)review(?:-|$)/.test(command)) return 'reviewing'
  }
  return null
}

function linkIsDiscussedRatherThanInvoked(before: string): boolean {
  return /\b(?:do not|don't|dont|not|never)(?:\s+(?:ever|[a-z]+ly)){0,2}\s*$/i.test(before) ||
    /\b(?:do not|don't|dont)\s+(?:invoke|run|use|start)\b/i.test(before) ||
    /\b(?:not invoking|not running|not using|not starting|never invoke|never run|avoid invoking|avoid running)\b/i.test(before) ||
    /^\s*(?:why|how)\s+(?:does|is|can|could|would)\b/i.test(before) ||
    /\b(?:example|quoted?|literal|classification|misclassif(?:y|ied|ication)?|marker|mention(?:ed|ing)?|discuss(?:ed|ing)?|reference(?:d|ing)?)\b/i.test(before)
}

function commandTokenIsQuoted(line: string, tokenIndex: number): boolean {
  let quote: "'" | '"' | null = null
  for (let index = 0; index < tokenIndex; index += 1) {
    const character = line[index]
    if (character !== "'" && character !== '"') continue
    if (index > 0 && line[index - 1] === '\\') continue
    if (
      character === "'" &&
      /[a-z0-9]/i.test(line[index - 1] ?? '') &&
      /[a-z0-9]/i.test(line[index + 1] ?? '')
    ) continue
    if (quote === character) quote = null
    else if (quote === null) quote = character
  }
  return quote !== null
}

function requestBody(message: string): string {
  const lines = message.split('\n')
  const marker = lines.findIndex((line) => /^## My request for Codex:\s*$/i.test(line.trim()))
  return marker === -1 ? message : lines.slice(marker + 1).join('\n')
}
