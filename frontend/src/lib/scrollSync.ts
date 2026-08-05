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

/**
 * Reads anchors out of rendered preview content.
 *
 * Measured with `getBoundingClientRect` deltas rather than `offsetTop`, so the
 * result does not depend on any ancestor being positioned.
 *
 * Untested by design: jsdom has no layout engine and reports every rectangle
 * as zero. Keeping this to three lines is what makes that acceptable — the
 * logic worth testing lives in createScrollSync and previewOffsetForLine.
 */
export function collectAnchors(container: HTMLElement): Anchor[] {
  const containerTop = container.getBoundingClientRect().top
  const anchors: Anchor[] = []
  for (const el of container.querySelectorAll<HTMLElement>('[data-source-line]')) {
    const line = Number(el.dataset.sourceLine)
    if (!Number.isFinite(line) || line < 1) continue
    anchors.push({
      line,
      top: el.getBoundingClientRect().top - containerTop + container.scrollTop,
    })
  }
  return anchors.sort((a, b) => a.line - b.line)
}

export interface ScrollSyncTarget {
  getAnchors(): Anchor[]
  getScrollHeight(): number
  setScrollTop(y: number): void
}

/**
 * Holds measured anchors between syncs, since measuring forces layout and a
 * scroll produces a burst of events. The cache is invalidated by the caller on
 * re-render, on chart hydration completing, and on resize; it is rebuilt
 * lazily on the next sync that needs it rather than eagerly on invalidation.
 */
export function createScrollSync(target: ScrollSyncTarget) {
  let anchors: Anchor[] | null = null
  return {
    invalidate(): void {
      anchors = null
    },
    sync(line: number, docLines: number): void {
      anchors ??= target.getAnchors()
      if (anchors.length === 0) return
      target.setScrollTop(
        previewOffsetForLine(anchors, line, docLines, target.getScrollHeight()),
      )
    },
  }
}
