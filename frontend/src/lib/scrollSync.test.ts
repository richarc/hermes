import { describe, it, expect } from 'vitest'
import { previewOffsetForLine, type Anchor } from './scrollSync'

// line 10 → 500px, line 20 → 1500px. 10 source lines spanning 1000 rendered px.
const ANCHORS: Anchor[] = [
  { line: 10, top: 500 },
  { line: 20, top: 1500 },
]
const DOC_LINES = 40
const SCROLL_HEIGHT = 4000

describe('previewOffsetForLine', () => {
  it('returns an anchor exactly when the line lands on one', () => {
    expect(previewOffsetForLine(ANCHORS, 10, DOC_LINES, SCROLL_HEIGHT)).toBe(500)
    expect(previewOffsetForLine(ANCHORS, 20, DOC_LINES, SCROLL_HEIGHT)).toBe(1500)
  })

  it('interpolates between two anchors', () => {
    // halfway between line 10 and line 20 → halfway between 500 and 1500
    expect(previewOffsetForLine(ANCHORS, 15, DOC_LINES, SCROLL_HEIGHT)).toBe(1000)
  })

  it('interpolates from a virtual (line 1, y 0) before the first anchor', () => {
    // frontmatter and anything above the first block still scrolls smoothly
    // rather than pinning to the top. Line 1 → 0; line 10 → 500; so line 5.5
    // would be 250. Use line 4: (4-1)/(10-1) = 1/3 of 500.
    expect(previewOffsetForLine(ANCHORS, 4, DOC_LINES, SCROLL_HEIGHT)).toBeCloseTo(166.67, 1)
  })

  it('interpolates toward a virtual (docLines, scrollHeight) after the last anchor', () => {
    // line 20 → 1500, line 40 → 4000. Line 30 is halfway: 2750.
    expect(previewOffsetForLine(ANCHORS, 30, DOC_LINES, SCROLL_HEIGHT)).toBe(2750)
  })

  it('returns 0 when there are no anchors', () => {
    expect(previewOffsetForLine([], 12, DOC_LINES, SCROLL_HEIGHT)).toBe(0)
  })

  it('maps proportionally within a block that renders far taller than its source', () => {
    // The case the whole design exists for: a Vega chart occupying 3 source
    // lines and 2000 rendered pixels. Scrolling one line into it must advance
    // the preview a third of the way through the chart, not skip it.
    const chart: Anchor[] = [
      { line: 10, top: 500 },
      { line: 13, top: 2500 },
    ]
    expect(previewOffsetForLine(chart, 11, DOC_LINES, SCROLL_HEIGHT)).toBeCloseTo(1166.67, 1)
    expect(previewOffsetForLine(chart, 12, DOC_LINES, SCROLL_HEIGHT)).toBeCloseTo(1833.33, 1)
  })

  it('clamps into [0, scrollHeight]', () => {
    expect(previewOffsetForLine(ANCHORS, -5, DOC_LINES, SCROLL_HEIGHT)).toBe(0)
    expect(previewOffsetForLine(ANCHORS, 9999, DOC_LINES, SCROLL_HEIGHT)).toBe(SCROLL_HEIGHT)
  })

  it('does not divide by zero when span <= 0', () => {
    // Single anchor at line 1, query at line 2 (beyond anchor) in 1-line document.
    // The loop leaves before at the real anchor (1, 0) and after at the virtual
    // default (also line 1 when docLines: 1), so span = 0 and the guard must return.
    expect(previewOffsetForLine([{ line: 1, top: 0 }], 2, 1, 0)).toBe(0)
  })

  it('returns anchor when query line matches an anchor line exactly', () => {
    // Sanity check: exact match is a common case and should short-circuit.
    expect(previewOffsetForLine([{ line: 1, top: 0 }], 1, 1, 0)).toBe(0)
  })
})
