// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  previewOffsetForLine,
  createScrollSync,
  collectAnchors,
  type Anchor,
  type ScrollSyncTarget,
} from './scrollSync'

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

function fakeTarget(anchors: Anchor[], scrollHeight = 4000) {
  const calls: number[] = []
  let measured = 0
  const target: ScrollSyncTarget = {
    getAnchors: () => {
      measured++
      return anchors
    },
    getScrollHeight: () => scrollHeight,
    setScrollTop: (y) => calls.push(y),
  }
  return { target, calls, measurements: () => measured }
}

describe('createScrollSync', () => {
  it('scrolls the target to the mapped offset', () => {
    const { target, calls } = fakeTarget(ANCHORS)
    createScrollSync(target).sync(15, DOC_LINES)
    expect(calls).toEqual([1000])
  })

  it('measures anchors once and reuses them across syncs', () => {
    const { target, measurements } = fakeTarget(ANCHORS)
    const sync = createScrollSync(target)
    sync.sync(12, DOC_LINES)
    sync.sync(14, DOC_LINES)
    sync.sync(16, DOC_LINES)
    expect(measurements()).toBe(1)
  })

  it('re-measures after invalidate', () => {
    const { target, measurements } = fakeTarget(ANCHORS)
    const sync = createScrollSync(target)
    sync.sync(12, DOC_LINES)
    sync.invalidate()
    sync.sync(12, DOC_LINES)
    expect(measurements()).toBe(2)
  })

  it('does not scroll when the document has no anchors', () => {
    const { target, calls } = fakeTarget([])
    createScrollSync(target).sync(12, DOC_LINES)
    expect(calls).toEqual([])
  })

  it('re-measures on the next sync, not eagerly on invalidate', () => {
    const { target, measurements } = fakeTarget(ANCHORS)
    const sync = createScrollSync(target)
    sync.sync(12, DOC_LINES)
    sync.invalidate()
    expect(measurements()).toBe(1) // nothing measured yet
    sync.sync(12, DOC_LINES)
    expect(measurements()).toBe(2)
  })
})

describe('collectAnchors', () => {
  it('drops elements whose data-source-line is malformed', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-source-line="abc"></div>
      <div data-source-line="0"></div>
      <div data-source-line=""></div>
    `
    expect(collectAnchors(container)).toEqual([])
  })

  it('keeps a valid element and reports the line it was tagged with', () => {
    const container = document.createElement('div')
    container.innerHTML = `<div data-source-line="7"></div>`
    expect(collectAnchors(container).map((a) => a.line)).toEqual([7])
  })

  it('returns anchors sorted ascending by line, regardless of DOM order', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-source-line="30"></div>
      <div data-source-line="5"></div>
      <div data-source-line="12"></div>
    `
    expect(collectAnchors(container).map((a) => a.line)).toEqual([5, 12, 30])
  })
})
