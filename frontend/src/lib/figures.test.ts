import { describe, it, expect } from 'vitest'
import {
  CHART_WIDTH_PX,
  captionFromTitle,
  chartCaption,
  chartWidthPx,
  cssTextAlign,
  figureLabel,
} from './figures'
// The plugin is exercised through render() rather than against tokens
// directly: what matters is the HTML a document produces, and that is also
// the only place the fence renderer's half of the work shows up.
import { render } from './renderer'

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

const fence = (spec: string) => '```vega-lite\n' + spec + '\n```'

describe('figures: what becomes one', () => {
  it('captions a chart whose spec has a title', () => {
    const html = render(fence('{"title":"Recovered sources","mark":"bar"}'))
    expect(html).toContain('<figure')
    expect(html).toContain('<figcaption>Figure 1 — Recovered sources</figcaption>')
  })

  it('accepts all three title shapes', () => {
    expect(render(fence('{"title":{"text":"Sources"},"mark":"bar"}'))).toContain(
      'Figure 1 — Sources',
    )
    expect(render(fence('{"title":{"text":["one","two"]},"mark":"bar"}'))).toContain(
      'Figure 1 — one two',
    )
  })

  it('leaves an untitled chart exactly as it was', () => {
    const html = render(fence('{"mark":"bar"}'))
    expect(html).toContain('class="vega-lite-chart"')
    expect(html).not.toContain('<figure')
    expect(html).not.toContain('<figcaption')
  })

  it('leaves a chart with an unusable title shape alone', () => {
    expect(render(fence('{"title":42,"mark":"bar"}'))).not.toContain('<figure')
    expect(render(fence('{"title":null,"mark":"bar"}'))).not.toContain('<figure')
  })

  it('leaves an unparseable chart alone, still as a chart placeholder', () => {
    const html = render(fence('not json'))
    expect(html).not.toContain('<figure')
    expect(html).toContain('class="vega-lite-chart"')
  })

  it('captions an image that is alone in its paragraph', () => {
    const html = render('![Recovered map](map.png)\n')
    expect(html).toContain('<figure')
    expect(html).toContain('<figcaption>Figure 1 — Recovered map</figcaption>')
  })

  it('keeps the alt attribute as well as adding the caption', () => {
    // The two serve different readers: the caption is visible to everyone,
    // the alt describes the image when it fails to load or is read aloud.
    const html = render('![Recovered map](map.png)\n')
    expect(html).toContain('alt="Recovered map"')
  })

  it('leaves an empty-alt image decorative and unnumbered', () => {
    const html = render('![](spacer.png)\n')
    expect(html).not.toContain('<figure')
    expect(html).toContain('<p data-source-line="1"')
  })

  it('leaves a linked image alone — only a bare image qualifies', () => {
    const html = render('[![Recovered map](map.png)](https://example.com)\n')
    expect(html).not.toContain('<figure')
  })

  it('leaves two images in one paragraph alone — ambiguous which is captioned', () => {
    const html = render('![one](a.png) ![two](b.png)\n')
    expect(html).not.toContain('<figure')
  })

  it('leaves an image with surrounding text alone', () => {
    const html = render('See ![one](a.png) here.\n')
    expect(html).not.toContain('<figure')
  })
})

describe('figures: numbering', () => {
  it('numbers charts and images in one sequence, in document order', () => {
    const doc =
      fence('{"title":"Sources","mark":"bar"}') +
      '\n\n![Recovered map](map.png)\n\n' +
      fence('{"title":"Yield","mark":"line"}')
    const html = render(doc)
    expect(html).toContain('Figure 1 — Sources')
    expect(html).toContain('Figure 2 — Recovered map')
    expect(html).toContain('Figure 3 — Yield')
  })

  it('does not spend a number on an uncaptioned block', () => {
    const doc = fence('{"mark":"bar"}') + '\n\n![Recovered map](map.png)\n'
    expect(render(doc)).toContain('Figure 1 — Recovered map')
  })

  it('renumbers everything below a figure inserted above them', () => {
    const below = '![Recovered map](map.png)\n'
    expect(render(below)).toContain('Figure 1 — Recovered map')
    const html = render('![Overview](overview.png)\n\n' + below)
    // Both figures must exist, not just the second one's number: a bug that
    // dropped the first image as a figure while still incrementing the
    // counter would make the lone 'Figure 2 —' assertion pass regardless.
    expect(html.match(/<figure/g)).toHaveLength(2)
    expect(html).toContain('Figure 1 — Overview')
    expect(html).toContain('Figure 2 — Recovered map')
  })
})

describe('figures: the title never renders twice', () => {
  it('strips the title from the spec handed to the hydrator', () => {
    // Left in, Vega-Lite draws the caption inside the SVG as well.
    const html = render(fence('{"title":"Sources","mark":"bar"}'))
    expect(html).not.toContain('&quot;title&quot;')
    expect(html).toContain('Figure 1 — Sources')
  })

  it('leaves the title in place on a chart that is not a figure', () => {
    // No caption is drawn below it, so the in-SVG title is all there is.
    const html = render(fence('{"title":42,"mark":"bar"}'))
    expect(html).toContain('&quot;title&quot;')
  })
})

describe('figures: scroll-sync anchors', () => {
  it('gives a chart figure exactly one data-source-line', () => {
    // collectAnchors() takes every [data-source-line] as an anchor, so an
    // attribute on both the <figure> and its child would be two anchors for
    // one source line at different offsets — a degenerate interpolation
    // segment for previewOffsetForLine.
    const html = render(fence('{"title":"Sources","mark":"bar"}'))
    expect(html.match(/data-source-line/g)).toHaveLength(1)
    expect(html).toMatch(/<figure data-source-line="1"/)
  })

  it('gives an image figure exactly one data-source-line', () => {
    const html = render('![Recovered map](map.png)\n')
    expect(html.match(/data-source-line/g)).toHaveLength(1)
    expect(html).toMatch(/<figure data-source-line="1"/)
  })

  it('anchors a figure past the frontmatter, like every other block', () => {
    const html = render('---\ncsl: apa\n---\n\n![Recovered map](map.png)\n')
    expect(html).toMatch(/<figure data-source-line="5"/)
  })

  it('gives every top-level block its own anchor in a mixed document', () => {
    // Counting anchors on a document made only of figures (the tests above)
    // would also pass if figures suppressed anchors everywhere else. This
    // mixes figures in among ordinary blocks and checks each one still gets
    // exactly its own anchor, on the right element.
    const doc = [
      '# Title',
      '',
      'Intro paragraph.',
      '',
      fence('{"title":"Sources","mark":"bar"}'),
      '',
      '![Recovered map](map.png)',
      '',
      'Another paragraph.',
      '',
      fence('{"mark":"line"}'),
      '',
    ].join('\n')
    const html = render(doc)

    // Six top-level blocks, six anchors — none doubled onto a figure's child.
    expect(html.match(/data-source-line/g)).toHaveLength(6)
    expect(html).toMatch(/<h1 data-source-line="1"/)
    expect(html).toMatch(/<p data-source-line="3"/)
    expect(html).toMatch(/<figure data-source-line="5"/)
    expect(html).toMatch(/<figure data-source-line="9"/)
    expect(html).toMatch(/<p data-source-line="11"/)
    expect(html).toMatch(/<div class="vega-lite-chart" data-source-line="13"/)
  })
})

describe('figures: caption text is escaped', () => {
  it('escapes HTML-significant characters in a chart caption', () => {
    const html = render(fence('{"title":"a <b> & c","mark":"bar"}'))
    expect(html).toContain('&lt;b&gt; &amp; c')
    expect(html).not.toContain('<b>')
  })

  it('escapes HTML-significant characters in an image caption', () => {
    const html = render('![a <b> & c](map.png)\n')
    expect(html).toContain('&lt;b&gt; &amp; c')
    expect(html).not.toContain('<b>')
  })
})
