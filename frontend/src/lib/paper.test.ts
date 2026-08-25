import { describe, it, expect } from 'vitest'
import {
  PAGE_MARGIN_MM,
  sheetWidthMm,
  sheetMarginPercent,
  sheetStyle,
  DEFAULT_PAPER_SIZE,
  DEFAULT_ORIENTATION,
} from './paper'

describe('sheetWidthMm', () => {
  it('gives the short edge in portrait and the long edge in landscape', () => {
    expect(sheetWidthMm('a4', 'portrait')).toBe(210)
    expect(sheetWidthMm('a4', 'landscape')).toBe(297)
    expect(sheetWidthMm('letter', 'portrait')).toBe(216)
    expect(sheetWidthMm('letter', 'landscape')).toBe(279)
  })
})

describe('sheetMarginPercent', () => {
  // The margin is a percentage rather than a length so it stays
  // proportionally true when a narrow pane shrinks the sheet below true
  // size. Percentage padding resolves against width, so each paper and
  // orientation needs its own value: one fixed percentage would draw 25mm on
  // A4 portrait and 35mm on A4 landscape while @page printed 25mm for both.
  it('is 25mm expressed against each sheet width', () => {
    expect(sheetMarginPercent('a4', 'portrait')).toBeCloseTo(11.9, 2)
    expect(sheetMarginPercent('a4', 'landscape')).toBeCloseTo(8.42, 2)
    expect(sheetMarginPercent('letter', 'portrait')).toBeCloseTo(11.57, 2)
    expect(sheetMarginPercent('letter', 'landscape')).toBeCloseTo(8.96, 2)
  })

  it('always resolves back to the one page margin', () => {
    // The property this file exists to guarantee: whatever the paper, the
    // percentage times the width is 25mm, so the sheet and @page agree.
    for (const size of ['a4', 'letter'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const mm = (sheetMarginPercent(size, orientation) / 100) * sheetWidthMm(size, orientation)
        expect(mm).toBeCloseTo(PAGE_MARGIN_MM, 4)
      }
    }
  })
})

describe('sheetStyle', () => {
  // The formatting boundary. sheetMarginPercent is exact (25/210*100 is
  // 11.904761904761905), which is what the identity test above needs, but
  // interpolating that straight into a style attribute writes all seventeen
  // digits. Rounding lives here rather than in the percentage itself so the
  // exact value stays available to the assertion that it resolves to 25mm.
  it('writes all three custom properties, the margin rounded to three decimals', () => {
    expect(sheetStyle('a4', 'portrait')).toBe(
      '--sheet-width: 210mm; --sheet-margin: 11.905%; --sheet-margin-max: 25mm',
    )
    expect(sheetStyle('a4', 'landscape')).toBe(
      '--sheet-width: 297mm; --sheet-margin: 8.418%; --sheet-margin-max: 25mm',
    )
    expect(sheetStyle('letter', 'portrait')).toBe(
      '--sheet-width: 216mm; --sheet-margin: 11.574%; --sheet-margin-max: 25mm',
    )
    expect(sheetStyle('letter', 'landscape')).toBe(
      '--sheet-width: 279mm; --sheet-margin: 8.961%; --sheet-margin-max: 25mm',
    )
  })

  it('carries the page margin as an absolute length as well as a percentage', () => {
    // Why both exist, and the arithmetic the CSS min() depends on.
    //
    // Percentage padding resolves against the CONTAINING BLOCK — the preview
    // pane — not against the sheet's own capped width. While the pane is
    // narrower than the paper the two coincide, because the sheet is then
    // exactly the pane wide; once the pane is wider the sheet stops at the
    // paper width and the percentage does not, so the margins grow and the
    // measure shrinks as the user gives the preview MORE room. The sheet
    // still looks like A4 while its text column no longer matches the PDF's.
    //
    // min(percentage, absolute) is right in both regimes, and this is that
    // claim in arithmetic rather than in a comment.
    // What the browser does with `padding: min(<pct>, <length>)`, in mm: the
    // percentage against the pane's inline size, the length as written.
    const paddingMm = (style: string, paneMm: number) => {
      const pct = Number(/--sheet-margin: ([\d.]+)%/.exec(style)![1])
      const max = Number(/--sheet-margin-max: ([\d.]+)mm/.exec(style)![1])
      return Math.min((pct / 100) * paneMm, max)
    }
    // Two decimals, not three: the emitted percentage is itself rounded to
    // three, so resolving it against a width reintroduces up to a thousandth
    // of a millimetre. That is the rounding, not a divergence.
    for (const size of ['a4', 'letter'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const style = sheetStyle(size, orientation)
        const paper = sheetWidthMm(size, orientation)
        // Pane exactly the paper's width: the two terms are equal, and the
        // margin is the one @page prints.
        expect(paddingMm(style, paper)).toBeCloseTo(PAGE_MARGIN_MM, 2)
        // Pane wider — the regime the bug lived in. The percentage alone gave
        // 2x this at twice the width; the absolute value now wins instead.
        expect(paddingMm(style, paper * 1.3)).toBeCloseTo(PAGE_MARGIN_MM, 2)
        expect(paddingMm(style, paper * 2)).toBeCloseTo(PAGE_MARGIN_MM, 2)
        // Pane narrower: the sheet has shrunk to the pane, so the margin has
        // to shrink with it or the measure would be squeezed twice over.
        expect(paddingMm(style, paper / 2)).toBeCloseTo(PAGE_MARGIN_MM / 2, 2)
      }
    }
  })
})

describe('defaults', () => {
  it('matches the Go defaults in settings.go', () => {
    expect(DEFAULT_PAPER_SIZE).toBe('a4')
    expect(DEFAULT_ORIENTATION).toBe('portrait')
  })
})
