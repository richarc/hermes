import type MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import citeprocModule from 'citeproc'
import type { CSLEntry } from './bibliography'
import apa from '../assets/csl/apa.csl?raw'
import chicago from '../assets/csl/chicago-author-date.csl?raw'
import ieee from '../assets/csl/ieee.csl?raw'
import vancouver from '../assets/csl/vancouver.csl?raw'
import harvard from '../assets/csl/harvard-cite-them-right.csl?raw'
import localeEnUS from '../assets/csl/locales-en-US.xml?raw'

// CJS/ESM interop differs between Vitest and Vite's browser pre-bundle.
const CSL = ((citeprocModule as { default?: unknown }).default ??
  citeprocModule) as { Engine: new (sys: unknown, style: string) => CiteprocEngine }

interface CiteprocEngine {
  /**
   * Rebuilds the processor from a document-ordered cluster list and returns
   * `[citationID, noteIndex, html]` per cluster, in that same order.
   */
  rebuildProcessorState(
    citations: unknown[],
    mode?: string,
    uncitedItemIDs?: string[],
  ): [string, number, string][]
  makeBibliography(): [{ bibstart: string; bibend: string }, string[]] | false
}

const STYLES: Record<string, string> = {
  apa,
  'chicago-author-date': chicago,
  ieee,
  vancouver,
  harvard,
}
export const STYLE_IDS = Object.keys(STYLES) as readonly string[]

export interface CitationItem {
  key: string
  prefix?: string
  suffix?: string
  locator?: string
  label?: string
  suppressAuthor?: boolean
}

export interface CitationCluster {
  items: CitationItem[]
  mode?: 'composite'
}

export interface CitationFormatter {
  format(clusters: CitationCluster[]): { texts: string[]; bibliographyHtml: string }
  has(key: string): boolean
}

export function createCitationFormatter(
  entries: CSLEntry[],
  styleId: string,
): CitationFormatter {
  const style = STYLES[styleId] ?? STYLES.apa
  const byId = new Map(entries.map((e) => [e.id, e]))
  const sys = {
    retrieveItem: (id: string) => byId.get(id),
    retrieveLocale: () => localeEnUS,
  }
  // Constructing an engine parses the entire CSL style, which costs ~230 ms for
  // APA and ~500 ms for Chicago — against ~0.2 ms to actually format a cluster.
  // format() runs on every preview render, so the engine is built once and
  // reused. It is built lazily so a document that cites nothing never pays at
  // all. rebuildProcessorState re-derives the item registry and citation state
  // from the cluster list it is handed, so a reused engine carries nothing over
  // from the previous render — see the reuse tests in citations.test.ts.
  let engine: CiteprocEngine | undefined
  return {
    has: (key) => byId.has(key),
    format(clusters) {
      const texts: string[] = new Array(clusters.length).fill('')
      // citeproc's result indices are positions among SUBMITTED clusters, not
      // original cluster positions. Since empty clusters are never submitted,
      // map submitted index -> original index to keep texts[] aligned with
      // the caller's cluster array.
      const submittedToOriginal: number[] = []
      const citations = clusters.flatMap((cluster, i) => {
        if (cluster.items.length === 0) return [] // caller-blanked: keep '' at index i
        submittedToOriginal.push(i)
        return [
          {
            citationID: `cite-${i}`,
            citationItems: cluster.items.map((item) => ({
              id: item.key,
              prefix: item.prefix,
              suffix: item.suffix,
              locator: item.locator,
              label: item.label,
              'suppress-author': item.suppressAuthor || undefined,
            })),
            properties: { noteIndex: 0, ...(cluster.mode ? { mode: cluster.mode } : {}) },
          },
        ]
      })
      if (citations.length === 0) return { texts, bibliographyHtml: '' }

      engine ??= new CSL.Engine(sys, style)
      for (const [submitted, entry] of engine.rebuildProcessorState(citations, 'html').entries()) {
        // A sparse slot would mean citeproc reported no text for a cluster it
        // was given; leave the '' rather than throwing off the alignment.
        if (entry) texts[submittedToOriginal[submitted]] = entry[2]
      }
      const bib = engine.makeBibliography()
      const bibliographyHtml = bib
        ? bib[0].bibstart + bib[1].join('') + bib[0].bibend
        : ''
      return { texts, bibliographyHtml }
    },
  }
}

// --- markdown-it citation syntax (Pandoc subset) -------------------------

/** Pandoc's citekey charset: `@key` or `[@key]`. */
export const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*/

const LOCATOR_RE =
  /^,\s*(?:(pp?\.|pages?)\s*|(chap(?:ter)?\.?)\s*|(sec(?:tion)?\.?)\s*)?(\d[\d\s,–-]*)\s*$/

/** Splits a bracketed item's trailing text into a locator + label, if recognized. */
function splitLocator(suffix: string): { locator?: string; label?: string; suffix?: string } {
  const m = suffix.match(LOCATOR_RE)
  if (!m) return suffix ? { suffix } : {}
  const label = m[2] ? 'chapter' : m[3] ? 'section' : 'page'
  return { locator: m[4].trim(), label }
}

/**
 * Matches a citekey at the start of `text` (immediately after an `@`) and
 * splits off any trailing sentence punctuation (`.`, `:`, `#`, `?`), which
 * belongs to the surrounding prose rather than the key itself.
 */
function parseKey(text: string): { key: string; rest: string } | null {
  const m = text.match(KEY_RE)
  if (!m) return null
  const key = m[0].replace(/[.:#?]+$/, '')
  if (!key) return null
  return { key, rest: text.slice(key.length) }
}

function parseBracketContent(content: string): CitationItem[] | null {
  const items: CitationItem[] = []
  for (const part of content.split(';')) {
    const at = part.indexOf('@')
    if (at === -1) return null
    let prefix = part.slice(0, at)
    let suppressAuthor = false
    if (prefix.trimEnd().endsWith('-')) {
      prefix = prefix.trimEnd().slice(0, -1)
      suppressAuthor = true
    }
    const parsed = parseKey(part.slice(at + 1))
    if (!parsed) return null
    const item: CitationItem = { key: parsed.key }
    const trimmedPrefix = prefix.replace(/^\s+/, '')
    if (trimmedPrefix) item.prefix = trimmedPrefix
    if (suppressAuthor) item.suppressAuthor = true
    Object.assign(item, splitLocator(parsed.rest.trimEnd()))
    items.push(item)
  }
  return items.length ? items : null
}

function pushCitation(
  state: StateInline,
  tokenType: string,
  cluster: CitationCluster,
  raw: string,
): void {
  const env = state.env as { citations?: CitationCluster[] }
  env.citations ??= []
  const index = env.citations.length
  env.citations.push(cluster)
  const token = state.push(tokenType, '', 0)
  token.meta = { index }
  token.content = raw
}

/**
 * Finds the `]` that balances the `[` at `open`, tracking nested `[`/`]`
 * pairs. Returns -1 if the source runs out before the brackets balance
 * (e.g. an unclosed `[` — never absorbs unrelated trailing content).
 */
function findBalancedClose(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Inline rule for bracketed citations: `[@key]`, `[see @key, p. 33; @other]`.
 * Registered AFTER `link` (see `citationPlugin`) so a genuine link or
 * reference link always gets first refusal at a `[...]`; we only see the
 * position at all once `link` has already declined it (e.g. an undefined
 * reference, or no `(`/`[` following at all), so there's no risk of
 * pre-emptively guessing wrong and silently dropping a citation that was
 * never going to become a link in the first place.
 */
function bracketRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state
  if (src[pos] !== '[') return false
  const close = findBalancedClose(src, pos)
  if (close === -1) return false
  const content = src.slice(pos + 1, close)
  if (!content.includes('@')) return false
  // A well-formed citation group's content is flat prose + citekeys; a
  // literal `[` inside it means this bracket actually encloses a nested
  // bracket construct (e.g. `[a [@cite] link](url)`, an inner citation, or a
  // link/reference the outer one can't also be — see the CommonMark
  // "links may not contain other links" precedent). Declining here (rather
  // than guessing what follows the close) lets that inner content get its
  // own turn at its own position instead of being absorbed as literal
  // prefix/suffix text.
  if (content.includes('[')) return false
  const items = parseBracketContent(content)
  if (!items) return false
  if (!silent) pushCitation(state, 'citation', { items }, src.slice(pos, close + 1))
  state.pos = close + 1
  return true
}

/** Inline rule for bare narrative citations: `@key` (not emails / mid-word). */
function narrativeRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state
  if (src[pos] !== '@') return false
  // Bare citations don't nest inside link text (only the bracketed form
  // does, via bracketRule, since it has explicit delimiters to recover with).
  // `linkLevel` exists at runtime (markdown-it's own `linkify` rule reads it
  // the same way) but is missing from @types/markdown-it's StateInline decl.
  if ((state as StateInline & { linkLevel: number }).linkLevel > 0) return false
  // must not be mid-word (emails, handles-in-words), nor immediately after a
  // `[` — that position belongs to bracketRule; if it declined (e.g. an
  // unclosed bracket), the `@` shouldn't be reinterpreted as a bare citation.
  const before = pos === 0 ? '' : src[pos - 1]
  if (before && /[\w.\-@[]/.test(before)) return false
  const parsed = parseKey(src.slice(pos + 1))
  if (!parsed) return false
  if (!silent) {
    pushCitation(
      state,
      'citation_narrative',
      { items: [{ key: parsed.key }], mode: 'composite' },
      `@${parsed.key}`,
    )
  }
  state.pos = pos + 1 + parsed.key.length
  return true
}

/**
 * Registers Pandoc-subset citation syntax with a markdown-it instance:
 * bracketed groups (`[@key]`) and bare narrative citations (`@key`). Each
 * match emits a `<span class="citation" data-cite-index="N">` placeholder
 * and pushes the parsed `CitationCluster` onto `env.citations` in document
 * order, for a later render pass (Task 5) to replace with formatted text.
 */
export function citationPlugin(md: MarkdownIt): void {
  // Registered AFTER `link`: real links/reference links always get first
  // refusal at a `[`, and the citation rule only runs once `link` has
  // already declined (see `bracketRule`'s doc comment).
  md.inline.ruler.after('link', 'citation', bracketRule)
  md.inline.ruler.before('emphasis', 'citation_narrative', narrativeRule)
  const renderCitation = (tokens: Token[], idx: number) => {
    const t = tokens[idx]
    return `<span class="citation" data-cite-index="${t.meta.index}">${md.utils.escapeHtml(t.content)}</span>`
  }
  md.renderer.rules.citation = renderCitation
  md.renderer.rules.citation_narrative = renderCitation
}
