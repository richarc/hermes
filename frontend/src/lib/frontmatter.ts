export interface Frontmatter {
  body: string
  bibliography?: string
  csl?: string
}

const KNOWN_KEYS = ['bibliography', 'csl'] as const

// A leading block fenced by lines of exactly ---, accepting either line ending
// so documents authored on Windows parse the same as ones authored on Unix.
// Requiring the closing fence to end its own line keeps a longer rule such as
// ---- from terminating the block early. The inner group is optional so an
// empty block still parses.
const BLOCK_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

export function parseFrontmatter(markdown: string): Frontmatter {
  const match = BLOCK_RE.exec(markdown)
  if (!match) return { body: markdown }

  const result: Frontmatter = { body: markdown.slice(match[0].length) }
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/)
    if (!m) continue
    const key = m[1] as (typeof KNOWN_KEYS)[number]
    if (!KNOWN_KEYS.includes(key)) continue
    result[key] = m[2].replace(/^["']|["']$/g, '')
  }
  return result
}
