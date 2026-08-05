export interface Anchor {
  /** 1-based line in the source document where this block starts. */
  line: number
  /** Pixels from the top of the preview's scroll content. */
  top: number
}

function clamp(y: number, scrollHeight: number): number {
  return Math.max(0, Math.min(y, scrollHeight))
}

/**
 * Maps a source line to a preview scroll offset by interpolating between the
 * two anchors bracketing it.
 *
 * Interpolating *between* known-correct points is what makes divergent block
 * heights a non-problem: a chart occupying three source lines and 2000
 * rendered pixels is simply a long interval, with no error term to accumulate
 * down the rest of the document.
 *
 * Both ends use virtual anchors so the document's edges stay reachable:
 * `(line 1, y 0)` before the first real anchor — so frontmatter scrolls
 * smoothly instead of pinning to the top — and `(docLines, scrollHeight)`
 * after the last, so the end of the document is reachable rather than
 * clamping at the final block.
 *
 * `anchors` must be sorted ascending by line.
 */
export function previewOffsetForLine(
  anchors: Anchor[],
  line: number,
  docLines: number,
  scrollHeight: number,
): number {
  if (anchors.length === 0) return 0

  let beforeLine = 1
  let beforeTop = 0
  let afterLine = Math.max(docLines, 1)
  let afterTop = scrollHeight

  for (const anchor of anchors) {
    if (anchor.line === line) return clamp(anchor.top, scrollHeight)
    if (anchor.line < line) {
      beforeLine = anchor.line
      beforeTop = anchor.top
    } else {
      afterLine = anchor.line
      afterTop = anchor.top
      break
    }
  }

  const span = afterLine - beforeLine
  if (span <= 0) return clamp(beforeTop, scrollHeight)
  const ratio = (line - beforeLine) / span
  return clamp(beforeTop + ratio * (afterTop - beforeTop), scrollHeight)
}
