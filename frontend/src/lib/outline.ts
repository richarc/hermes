import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'

/** One heading, as the outline panel shows it. */
export interface OutlineEntry {
  /** 1–6. */
  level: number
  /** Plain text: emphasis, code and links are flattened to their words. */
  text: string
  /** 1-based document line, the same value the preview's data-source-line carries. */
  line: number
}

/**
 * A markdown-it core rule that collects the document's headings into
 * `env.outline`. A second consumer of the same token pass figures.ts walks:
 * the renderer already stamps every top-level block with its source line, so
 * the outline reuses that stamp rather than counting lines itself — which is
 * what keeps a click on an entry landing on exactly the line the preview
 * anchors to.
 *
 * Only level-0 headings count, the same restriction source_line and the
 * figure numbering apply: a heading quoted inside a blockquote is part of the
 * quote, not part of the document's structure. A `#` inside a fence never
 * becomes a heading token at all, so that case needs no handling here.
 *
 * Registered after source_line, which it reads from.
 */
export function outlinePlugin(md: MarkdownIt): void {
  md.core.ruler.push('outline', collectOutline)
}

function collectOutline(state: StateCore): boolean {
  const entries: OutlineEntry[] = []
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading_open' || token.level !== 0) continue
    const inline = tokens[i + 1]
    const line = Number(token.attrGet('data-source-line'))
    if (!Number.isFinite(line)) continue
    entries.push({
      level: Number(token.tag.slice(1)),
      text: plainText(inline),
      line,
    })
  }
  ;(state.env as { outline?: OutlineEntry[] }).outline = entries
  return true
}

/** The words of an inline token, with every span of markup flattened out. */
function plainText(inline: Token | undefined): string {
  if (!inline || inline.type !== 'inline' || !inline.children) return inline?.content ?? ''
  let out = ''
  for (const child of inline.children) {
    if (child.type === 'text' || child.type === 'code_inline') out += child.content
    else if (child.type === 'softbreak' || child.type === 'hardbreak') out += ' '
    // math_inline is KaTeX source; showing it raw is more useful than nothing.
    else if (child.type === 'math_inline') out += child.content
  }
  return out.trim()
}
