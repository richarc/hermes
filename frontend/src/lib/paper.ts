/**
 * Paper geometry, in one place.
 *
 * The preview draws the document as a sheet at true paper proportions, so the
 * app has to know what paper it is. These values are also what the PDF export
 * builds its NSPrintInfo from, which is the point: one source of truth means
 * the sheet cannot promise a measure the export does not deliver.
 */

export type PaperSize = 'a4' | 'letter'
export type PageOrientation = 'portrait' | 'landscape'

/** Must match settings.go's defaultSettings(). */
export const DEFAULT_PAPER_SIZE: PaperSize = 'a4'
export const DEFAULT_ORIENTATION: PageOrientation = 'portrait'

/**
 * The page margin, used by the sheet's padding and by @page alike. Changed
 * from 20mm in v0.8: A4 at 20mm gives an ~88-character measure, which is
 * poor. 25mm gives ~82 — still wide, because that is what a one-column A4
 * paper genuinely is.
 */
export const PAGE_MARGIN_MM = 25

/** Short and long edge in millimetres. */
const PAPER_MM: Record<PaperSize, { short: number; long: number }> = {
  a4: { short: 210, long: 297 },
  letter: { short: 216, long: 279 },
}

export function sheetWidthMm(size: PaperSize, orientation: PageOrientation): number {
  const paper = PAPER_MM[size] ?? PAPER_MM[DEFAULT_PAPER_SIZE]
  return orientation === 'landscape' ? paper.long : paper.short
}

/**
 * The page margin as a percentage of the sheet's width.
 *
 * A percentage rather than a length because percentage padding resolves
 * against width, so the margin stays proportionally correct when a narrow
 * preview pane shrinks the sheet below true paper size. It follows that the
 * value is per paper AND per orientation — a single fixed percentage would
 * draw 25mm on A4 portrait and 35mm on A4 landscape while @page printed 25mm
 * for both, so the sheet would lie for three of the four combinations.
 *
 * On its own this percentage is only half the margin, and the wrong half once
 * the pane is wide — see sheetStyle below and the .sheet rule in style.css.
 */
export function sheetMarginPercent(size: PaperSize, orientation: PageOrientation): number {
  return (PAGE_MARGIN_MM / sheetWidthMm(size, orientation)) * 100
}

/**
 * The sheet's geometry as an inline style, which is how it reaches CSS.
 *
 * Rounding happens here rather than in sheetMarginPercent so that the exact
 * value stays available to the test asserting the margin resolves back to
 * 25mm; three decimals is well below a device pixel at any sheet size.
 *
 * TWO margin properties, and both are needed. CSS resolves percentage padding
 * against the CONTAINING BLOCK's inline size — .preview-pane — never against
 * the element's own width, and the sheet's width is capped:
 * `min(var(--sheet-width), 100%)`. The two only coincide while the pane is
 * narrower than the paper, which is where `min()` picks `100%`. Once the pane
 * is wider the sheet stops growing at 210mm and the percentage does not, so a
 * 1265px pane (a 50/50 split on a 2560px display) drew 11.905% × 1265 = 150px
 * ≈ 39.7mm of padding per side: a 496px measure on screen against the PDF's
 * 605px, with every line break, figure fit and chart headroom different from
 * the export. Widening the preview made the margins wider and the measure
 * narrower, and nothing looked broken — the sheet was still A4-shaped.
 *
 * So style.css writes `padding: min(var(--sheet-margin), var(--sheet-margin-max))`
 * and this emits the absolute cap alongside the percentage. Pane at least as
 * wide as the paper: the percentage is ≥ 25mm, the cap wins, the sheet's
 * margin is exactly the one @page prints. Pane narrower: the percentage is
 * < 25mm, it wins, and the shrunk sheet keeps a proportionally true margin.
 * Both derive from PAGE_MARGIN_MM, so there is still one number.
 */
export function sheetStyle(size: PaperSize, orientation: PageOrientation): string {
  const margin = sheetMarginPercent(size, orientation).toFixed(3).replace(/\.?0+$/, '')
  return (
    `--sheet-width: ${sheetWidthMm(size, orientation)}mm; ` +
    `--sheet-margin: ${margin}%; ` +
    `--sheet-margin-max: ${PAGE_MARGIN_MM}mm`
  )
}
