/**
 * Shrink display maths that is wider than the sheet it sits on.
 *
 * The sheet shrinks below true paper width whenever the preview pane is
 * narrower than the paper (see the .sheet rule in style.css), but the type
 * does not shrink with it. A formula that fits the printed page can therefore
 * run off the right edge of the preview — KaTeX sets display maths
 * `white-space: nowrap`, so it never wraps.
 *
 * The fix scales the formula's font size, which KaTeX measures everything in,
 * so the result stays crisp and still takes part in layout (transform: scale()
 * would blur and would leave the old box behind for scrollSync.ts to measure).
 * The factor travels as the `--math-fit` custom property on each
 * `.katex-display`; style.css multiplies KaTeX's own font size by it, and
 * ignores it when printing, where the page is true width again.
 *
 * Below MIN_FIT a formula is left at MIN_FIT and scrolls sideways instead:
 * past that point it is too small to read, and a scrollbar is the lesser loss.
 */

export const MIN_FIT = 0.5

/**
 * Two passes, so layout is forced once rather than once per formula: clear
 * every factor (writes), measure every formula at natural size (reads), then
 * set the new factors (writes). A pass that interleaved them would lay the
 * document out again for each formula.
 */
export function fitDisplayMath(root: ParentNode): void {
  const displays = Array.from(root.querySelectorAll<HTMLElement>('.katex-display'))
  if (displays.length === 0) return

  for (const d of displays) d.style.removeProperty('--math-fit')

  const fits = displays.map((d) => {
    const katex = d.querySelector<HTMLElement>(':scope > .katex')
    if (!katex) return 1
    const available = katex.clientWidth
    const natural = katex.scrollWidth
    if (available <= 0 || natural <= available) return 1
    return Math.max(MIN_FIT, available / natural)
  })

  displays.forEach((d, i) => {
    // Three decimals is well under a pixel on any formula that fits a page.
    if (fits[i] < 1) d.style.setProperty('--math-fit', String(Math.floor(fits[i] * 1000) / 1000))
  })
}
