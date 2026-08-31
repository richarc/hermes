import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type { OutlineEntry } from './outline'

/**
 * The table of contents: slugs for heading anchors, the depth rule, and the
 * nested list the `[[toc]]` marker (or the top of the document) renders as.
 * Pure string work; the renderer owns where these are called from.
 */

/** An outline entry paired with the anchor slug its heading was given. */
export interface TocItem {
  entry: OutlineEntry
  slug: string
}

/** Pandoc's default, and the vocabulary is Pandoc's (`toc-depth`). */
export const DEFAULT_TOC_DEPTH = 3

/**
 * GitHub-style anchor slug: lowercased, whitespace to hyphens, everything
 * but letters, digits, hyphens and underscores dropped. Not deduplicated —
 * the renderer holds the per-document counter, since uniqueness is a
 * property of the document, not of one heading.
 */
export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
  return slug === '' ? 'heading' : slug
}

/**
 * The depth a heading must not exceed to be listed. Anything but a whole
 * number from 1 to 6 reads as the default: the key is advisory, and a typo
 * should degrade to the ordinary contents page, not an empty one.
 */
export function tocDepth(raw: string | undefined): number {
  if (raw === undefined || !/^[1-6]$/.test(raw.trim())) return DEFAULT_TOC_DEPTH
  return Number(raw.trim())
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The nested `<ul>` for the given items, in document order. Levels nest
 * relative to the first item's: a deeper item opens a list inside the
 * previous one (a jump over a level opens the wrappers it skipped), a
 * shallower one closes back out, and a heading shallower than the first is
 * listed at the first's depth — the alternative is markup that closes the
 * outermost list with items still to come.
 */
export function buildTocListHtml(items: TocItem[]): string {
  if (items.length === 0) return ''
  const link = (item: TocItem) =>
    `<a href="#${escapeHtml(item.slug)}">${escapeHtml(item.entry.text)}</a>`
  const first = items[0].entry.level
  let out = '<ul><li>' + link(items[0])
  let prev = first
  for (const item of items.slice(1)) {
    const level = Math.max(item.entry.level, first)
    if (level > prev) {
      out += '<ul>' + '<li><ul>'.repeat(level - prev - 1) + '<li>' + link(item)
    } else if (level === prev) {
      out += '</li><li>' + link(item)
    } else {
      out += '</li>' + '</ul></li>'.repeat(prev - level) + '<li>' + link(item)
    }
    prev = level
  }
  return out + '</li>' + '</ul></li>'.repeat(prev - first) + '</ul>'
}

/** What the plugin leaves in the render env for renderDocument to read. */
export interface TocEnv {
  tocEnabled?: boolean
  tocDepth?: number
  /** Every heading, with its slug — collected whether or not a ToC renders. */
  tocItems?: TocItem[]
  /** Set when a [[toc]] marker was found and replaced in place. */
  tocPlaced?: boolean
}

export function tocNavHtml(items: TocItem[], line: number): string {
  return `<nav class="toc" data-source-line="${line}"><h2>Contents</h2>${buildTocListHtml(items)}</nav>\n`
}

/**
 * A core rule with two jobs, run after source_line so the stamps exist.
 *
 * First it gives every level-0 heading an anchor id — always, ToC or not,
 * so hand-written [#fragment](…) links work too. The dedup counter lives in
 * this pass: uniqueness is a property of the document, so two renders of
 * the same document produce the same ids.
 *
 * Then, when the frontmatter asked for a ToC, the first level-0 paragraph
 * whose entire text is [[toc]] is replaced by the rendered contents — and
 * only headings after that paragraph are listed, which is what lets a title
 * page precede the contents without appearing in it. A fence's [[toc]] is
 * never a marker: it is fence content and produces no paragraph token.
 */
export function tocPlugin(md: MarkdownIt): void {
  md.core.ruler.push('toc', (state) => {
    const env = state.env as TocEnv
    const tokens = state.tokens
    const items: TocItem[] = []
    const seen = new Map<string, number>()
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token.type !== 'heading_open' || token.level !== 0) continue
      const text = headingText(state, i)
      const base = slugify(text)
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      const slug = n === 0 ? base : `${base}-${n}`
      token.attrSet('id', slug)
      const line = Number(token.attrGet('data-source-line'))
      if (!Number.isFinite(line)) continue
      items.push({ entry: { level: Number(token.tag.slice(1)), text, line }, slug })
    }
    env.tocItems = items
    if (!env.tocEnabled) return true

    const depth = env.tocDepth ?? DEFAULT_TOC_DEPTH
    for (let i = 0; i + 2 < tokens.length; i++) {
      const open = tokens[i]
      if (open.type !== 'paragraph_open' || open.level !== 0) continue
      const inline = tokens[i + 1]
      if (inline.type !== 'inline' || inline.content.trim().toLowerCase() !== '[[toc]]') continue
      if (tokens[i + 2].type !== 'paragraph_close') continue
      const markerLine = Number(open.attrGet('data-source-line'))
      const listed = items.filter(
        (it) => it.entry.level <= depth && (!Number.isFinite(markerLine) || it.entry.line > markerLine),
      )
      const nav = new state.Token('html_block', '', 0)
      nav.block = true
      nav.map = open.map
      nav.content = tocNavHtml(listed, Number.isFinite(markerLine) ? markerLine : 1)
      tokens.splice(i, 3, nav)
      env.tocPlaced = true
      break
    }
    return true
  })
}

/** The plain words of the heading whose heading_open sits at `idx`. */
function headingText(state: StateCore, idx: number): string {
  const inline = state.tokens[idx + 1]
  if (!inline || inline.type !== 'inline' || !inline.children) return inline?.content ?? ''
  let out = ''
  for (const child of inline.children) {
    if (child.type === 'text' || child.type === 'code_inline') out += child.content
    else if (child.type === 'softbreak' || child.type === 'hardbreak') out += ' '
    else if (child.type === 'math_inline') out += child.content
  }
  return out.trim()
}
