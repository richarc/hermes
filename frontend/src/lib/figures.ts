/**
 * Figure presentation: what makes a block a figure, what its caption reads,
 * and the two document-wide settings that place and size it.
 *
 * A caption is what makes a figure. Without one a chart or image renders
 * exactly as it did before this module existed, which is what keeps existing
 * documents untouched until their author adds a caption.
 */

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
