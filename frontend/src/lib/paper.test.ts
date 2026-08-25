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
  it('writes both custom properties, rounded to three decimals', () => {
    expect(sheetStyle('a4', 'portrait')).toBe('--sheet-width: 210mm; --sheet-margin: 11.905%')
    expect(sheetStyle('a4', 'landscape')).toBe('--sheet-width: 297mm; --sheet-margin: 8.418%')
    expect(sheetStyle('letter', 'portrait')).toBe('--sheet-width: 216mm; --sheet-margin: 11.574%')
    expect(sheetStyle('letter', 'landscape')).toBe('--sheet-width: 279mm; --sheet-margin: 8.961%')
  })
})

describe('defaults', () => {
  it('matches the Go defaults in settings.go', () => {
    expect(DEFAULT_PAPER_SIZE).toBe('a4')
    expect(DEFAULT_ORIENTATION).toBe('portrait')
  })
})
