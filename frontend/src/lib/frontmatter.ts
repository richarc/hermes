export interface Frontmatter {
  body: string
  bibliography?: string
  csl?: string
  /**
   * 1-based line of the original document on which `body` starts. The renderer
   * passes markdown-it only the body, so its line numbers are body-relative;
   * scroll-sync anchors must be document-absolute to line up with the editor.
   */
  bodyStartLine: number
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
  if (!match) return { body: markdown, bodyStartLine: 1 }

  const result: Frontmatter = {
    body: markdown.slice(match[0].length),
    // match[0] ends with the newline after the closing fence, so the number of
    // complete lines it consumes is its newline count.
    bodyStartLine: match[0].split('\n').length,
  }
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/)
    if (!m) continue
    const key = m[1] as (typeof KNOWN_KEYS)[number]
    if (!KNOWN_KEYS.includes(key)) continue
    result[key] = m[2].replace(/^["']|["']$/g, '')
  }
  return result
}
