/**
 * Figure presentation: what makes a block a figure, what its caption reads,
 * the two document-wide settings that place and size it, and the markdown-it
 * plugin that numbers figures and builds their markup.
 *
 * A caption is what makes a figure. Without one a chart or image renders
 * exactly as it did before this module existed, which is what keeps existing
 * documents untouched until their author adds a caption.
 */

import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import { parseMermaidSource } from './mermaidSource'

export type ChartWidth = 'small' | 'medium' | 'large'
export type FigureAlignment = 'left' | 'centre' | 'right'

/**
 * These are Vega-Lite's `width`, which sizes the PLOTTING AREA and excludes
 * axes, tick labels and the legend — a chart at 400 occupies noticeably more
 * than 400px in total. Worth remembering before tuning them against a page.
 */
export const CHART_WIDTH_PX: Record<ChartWidth, number> = {
  small: 240,
  medium: 400,
  large: 560,
}

export const DEFAULT_CHART_WIDTH: ChartWidth = 'medium'

/** Pixels for a named width; anything unrecognised falls back to the default. */
export function chartWidthPx(name: string | undefined): number {
  return CHART_WIDTH_PX[name as ChartWidth] ?? CHART_WIDTH_PX[DEFAULT_CHART_WIDTH]
}

/**
 * The caption a Vega-Lite `title` carries, or '' if it carries none.
 *
 * Vega-Lite allows three shapes and all three are accepted: a bare string, an
 * object with a string `text`, and an object whose `text` is an array of
 * lines (joined with a space). Anything else — a number, a styling-only
 * object, `null` — is not a caption, so the block is not a figure.
 */
export function captionFromTitle(title: unknown): string {
  if (typeof title === 'string') return title.trim()
  if (typeof title === 'object' && title !== null && !Array.isArray(title)) {
    const text = (title as { text?: unknown }).text
    if (typeof text === 'string') return text.trim()
    if (Array.isArray(text) && text.every((t) => typeof t === 'string')) {
      return text.join(' ').trim()
    }
  }
  return ''
}

/** The caption a `vega-lite` block's spec text carries, or '' for none. */
export function chartCaption(specText: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(specText)
  } catch {
    // Unparseable JSON is not a figure. The existing error card in charts.ts
    // still reports the chart itself, so nothing is lost by declining here.
    return ''
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return ''
  return captionFromTitle((parsed as Record<string, unknown>).title)
}

/** The caption a `mermaid` block's source carries, or '' for none. */
export function mermaidCaption(source: string): string {
  return parseMermaidSource(source).title
}

/**
 * "Figure 2 — Recovered sources".
 *
 * Written into the HTML as real text rather than produced by a CSS counter,
 * so it survives copy-paste and PDF text extraction.
 */
export function figureLabel(n: number, caption: string): string {
  return `Figure ${n} — ${caption}`
}

/**
 * Hermes spells its own identifiers `centre`; CSS only understands `center`.
 * The mapping happens here, at the boundary, exactly as it already does for
 * colour/color — so no stylesheet rule ever carries the British spelling.
 */
export function cssTextAlign(alignment: string | undefined): 'left' | 'center' | 'right' {
  if (alignment === 'left') return 'left'
  if (alignment === 'right') return 'right'
  return 'center'
}

/** What the numbering pass stamps onto a token it decided is a figure. */
export interface FigureMeta {
  number: number
  caption: string
}

/** Reads that stamp back, for a renderer that hand-builds its own HTML. */
export function figureOf(token: Token): FigureMeta | null {
  const meta = token.meta as { figure?: FigureMeta } | null | undefined
  return meta?.figure ?? null
}

/**
 * Numbers figures and builds them.
 *
 * The pass needs no persistent state: render() re-runs on every debounced
 * change, so the count is recomputed each time and inserting a figure
 * renumbers everything below it on the next keystroke.
 *
 * Charts are only *stamped* here — they are emitted by renderer.ts's fence
 * renderer, which already hand-builds their HTML. Images need token surgery
 * instead: a <figure> cannot live inside the <p> markdown-it wraps them in,
 * so the paragraph tokens become figure tokens with a figcaption appended.
 */
export function figurePlugin(md: MarkdownIt): void {
  md.core.ruler.push('figures', numberFigures)
  md.renderer.rules.figcaption = (tokens, idx) =>
    `<figcaption>${md.utils.escapeHtml(tokens[idx].content)}</figcaption>`
}

function numberFigures(state: StateCore): boolean {
  let count = 0
  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i]
    // Only top-level blocks are figures — the same level-0 restriction the
    // source_line rule uses, so a chart quoted inside a blockquote or a list
    // item stays a plain chart rather than claiming a figure number.
    if (token.level !== 0) continue

    if (token.type === 'fence' && token.info.trim() === 'vega-lite') {
      const caption = chartCaption(token.content)
      if (caption === '') continue
      count += 1
      token.meta = { ...(token.meta ?? {}), figure: { number: count, caption } }
      continue
    }

    if (token.type === 'fence' && token.info.trim() === 'mermaid') {
      const caption = mermaidCaption(token.content)
      if (caption === '') continue
      count += 1
      token.meta = { ...(token.meta ?? {}), figure: { number: count, caption } }
      continue
    }

    if (token.type !== 'paragraph_open') continue
    const inline = state.tokens[i + 1]
    const close = state.tokens[i + 2]
    if (inline?.type !== 'inline' || close?.type !== 'paragraph_close') continue

    // Exactly one child, and it an image: a linked image is [link_open,
    // image, link_close], and two images (or an image with prose) leave text
    // tokens beside it. No empty text token ever sits next to a lone image
    // either — the inline parser only flushes `pending` into a text token
    // when it is non-empty — so a lone image really is a single child.
    const children = inline.children ?? []
    if (children.length !== 1 || children[0].type !== 'image') continue

    // renderInlineAsText is how markdown-it's own image renderer derives the
    // alt attribute, so this is the same text the <img> will carry.
    const alt = state.md.renderer
      .renderInlineAsText(children[0].children ?? [], state.md.options, state.env)
      .trim()
    // Empty alt stays decorative and unnumbered — the accessibility
    // convention, and it stops a spacer image consuming a figure number.
    if (alt === '') continue

    count += 1
    // Retagging keeps the paragraph's attributes, which is exactly what is
    // wanted: data-source-line moves onto the <figure> and off nothing else,
    // because the <img> never carried one.
    token.tag = 'figure'
    close.tag = 'figure'
    const caption = new state.Token('figcaption', 'figcaption', 0)
    caption.content = figureLabel(count, alt)
    state.tokens.splice(i + 2, 0, caption)
  }
  return true
}
