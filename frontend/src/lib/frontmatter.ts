export interface Frontmatter {
  body: string
  bibliography?: string
  csl?: string
}

const KNOWN_KEYS = ['bibliography', 'csl'] as const

export function parseFrontmatter(markdown: string): Frontmatter {
  if (!markdown.startsWith('---\n') && markdown !== '---') {
    return { body: markdown }
  }
  const end = markdown.indexOf('\n---', 3)
  if (end === -1) return { body: markdown }
  const block = markdown.slice(4, end)
  // body starts after the closing fence line (and one following newline)
  const afterFence = markdown.indexOf('\n', end + 1)
  const body = afterFence === -1 ? '' : markdown.slice(afterFence + 1)

  const result: Frontmatter = { body }
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/)
    if (!m) continue
    const key = m[1] as (typeof KNOWN_KEYS)[number]
    if (!KNOWN_KEYS.includes(key)) continue
    result[key] = m[2].replace(/^["']|["']$/g, '')
  }
  return result
}
