import { describe, it, expect } from 'vitest'
import {
  CHART_WIDTH_PX,
  captionFromTitle,
  chartCaption,
  chartWidthPx,
  cssTextAlign,
  figureLabel,
} from './figures'

describe('captionFromTitle: the three shapes Vega-Lite allows', () => {
  it('takes a plain string title', () => {
    expect(captionFromTitle('Recovered sources')).toBe('Recovered sources')
  })

  it('takes the text of an object title', () => {
    expect(captionFromTitle({ text: 'Recovered sources' })).toBe('Recovered sources')
  })

  it('joins a multi-line object title with a space', () => {
    expect(captionFromTitle({ text: ['line one', 'line two'] })).toBe('line one line two')
  })

  it('trims surrounding whitespace', () => {
    expect(captionFromTitle('  padded  ')).toBe('padded')
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['a number', 42],
    ['an object with no text', { anchor: 'start' }],
    ['an object with a non-string text', { text: 42 }],
    ['an array of non-strings', { text: [1, 2] }],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('returns no caption for %s', (_name, value) => {
    expect(captionFromTitle(value)).toBe('')
  })
})

describe('chartCaption', () => {
  it('reads the title out of spec text', () => {
    expect(chartCaption('{"title":"Sources","mark":"bar"}')).toBe('Sources')
  })

  it('returns no caption for unparseable JSON', () => {
    expect(chartCaption('not json')).toBe('')
  })

  it('returns no caption for a spec that is not an object', () => {
    expect(chartCaption('[1, 2]')).toBe('')
    expect(chartCaption('null')).toBe('')
  })
})

describe('figureLabel', () => {
  it('reads "Figure N — caption", with an em dash', () => {
    expect(figureLabel(2, 'Recovered sources')).toBe('Figure 2 — Recovered sources')
  })
})

describe('chartWidthPx', () => {
  it('maps each named width to its pixel value', () => {
    expect(chartWidthPx('small')).toBe(240)
    expect(chartWidthPx('medium')).toBe(400)
    expect(chartWidthPx('large')).toBe(560)
  })

  it('falls back to medium for an unknown or missing name', () => {
    expect(chartWidthPx(undefined)).toBe(CHART_WIDTH_PX.medium)
    expect(chartWidthPx('enormous')).toBe(CHART_WIDTH_PX.medium)
  })
})

describe('cssTextAlign', () => {
  it('maps Hermes spelling to the CSS keyword', () => {
    // The one mapping that cannot be checked by reading the CSS: `centre` is
    // Hermes' identifier, `center` is the only spelling CSS understands.
    expect(cssTextAlign('centre')).toBe('center')
  })

  it('passes left and right through unchanged', () => {
    expect(cssTextAlign('left')).toBe('left')
    expect(cssTextAlign('right')).toBe('right')
  })

  it('falls back to centre for an unknown or missing value', () => {
    expect(cssTextAlign(undefined)).toBe('center')
    expect(cssTextAlign('justified')).toBe('center')
  })
})
