/**
 * A memoising front for KaTeX's `renderToString`, handed to
 * @vscode/markdown-it-katex as its `katex` option so every formula the
 * plugin renders — inline, inline-block and display — goes through one
 * cache. A render happens on every keystroke pause and re-renders every
 * formula in the document at ~60 µs each; the formulas themselves change
 * only when the caret is inside one. Keyed on the TeX source and display
 * mode, which are the only per-call inputs — the other options are fixed
 * when the plugin is installed.
 *
 * Least-recently-used, so a long document that scrolls its formulas through
 * the limit still keeps the ones on screen. A throw is not cached: the
 * plugin turns it into error markup itself, and an invalid formula being
 * typed is the one case the cache cannot help with anyway.
 */
export interface KatexLike {
  renderToString(tex: string, options?: object): string
}

export interface KatexCache extends KatexLike {
  /** Entries currently held. */
  readonly size: number
}

export const DEFAULT_MAX_ENTRIES = 2000

export function createKatexCache(
  katex: KatexLike,
  { max = DEFAULT_MAX_ENTRIES }: { max?: number } = {},
): KatexCache {
  // Map keeps insertion order, so the first key is the least recently used
  // as long as a hit is re-inserted.
  const entries = new Map<string, string>()
  return {
    get size() {
      return entries.size
    },
    renderToString(tex, options) {
      const displayMode = (options as { displayMode?: boolean } | undefined)?.displayMode ?? false
      const key = (displayMode ? 'D' : 'I') + tex
      const hit = entries.get(key)
      if (hit !== undefined) {
        entries.delete(key)
        entries.set(key, hit)
        return hit
      }
      const html = katex.renderToString(tex, options)
      entries.set(key, html)
      if (entries.size > max) {
        entries.delete(entries.keys().next().value!)
      }
      return html
    },
  }
}
