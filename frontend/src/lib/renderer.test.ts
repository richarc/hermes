import { describe, it, expect } from 'vitest'
import { render } from './renderer'
import { createCitationFormatter } from './citations'
import type { CSLEntry } from './bibliography'

describe('render: markdown', () => {
  it('renders headings', () => {
    expect(render('# Introduction')).toContain('<h1>Introduction</h1>')
  })

  it('renders emphasis and paragraphs', () => {
    const html = render('Some *emphasised* text')
    expect(html).toContain('<p>')
    expect(html).toContain('<em>emphasised</em>')
  })

  it('escapes raw HTML (html: false)', () => {
    expect(render('<script>alert(1)</script>')).not.toContain('<script>')
  })

  it('renders ordinary fenced code blocks as code', () => {
    const html = render('```python\nprint(1)\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('print(1)')
  })
})

describe('render: math', () => {
  it('renders inline math with $..$', () => {
    expect(render('Euler: $e^{i\\pi} = -1$')).toContain('katex')
  })

  it('renders display math with $$..$$', () => {
    expect(render('$$\\int_0^1 x\\,dx$$')).toContain('katex-display')
  })

  it('renders invalid LaTeX as an inline error instead of throwing', () => {
    const html = render('$\\notacommand$')
    expect(html).toContain('katex')          // still produced output
    expect(html).toContain('#cc0000')        // errorColor styling present
  })

  it('leaves plain dollar amounts alone', () => {
    expect(render('costs $5 total')).not.toContain('katex')
  })
})

describe('render: vega-lite fences', () => {
  const spec = '{"mark": "bar", "data": {"values": [{"a": 1}]}}'

  it('turns a vega-lite fence into a chart placeholder', () => {
    const html = render('```vega-lite\n' + spec + '\n```')
    expect(html).toContain('class="vega-lite-chart"')
    expect(html).not.toContain('<pre>')
  })

  it('carries the spec text, HTML-escaped, in data-spec', () => {
    const html = render('```vega-lite\n' + spec + '\n```')
    expect(html).toContain('data-spec="')
    expect(html).toContain('&quot;mark&quot;')
  })

  it('passes malformed JSON through for the hydrator to report', () => {
    const html = render('```vega-lite\nnot json\n```')
    expect(html).toContain('class="vega-lite-chart"')
    expect(html).toContain('not json')
  })

  it('does not hijack other fence languages', () => {
    expect(render('```json\n{}\n```')).toContain('<pre>')
  })
})

const ENTRIES: CSLEntry[] = [
  { id: 'smith2020', type: 'article-journal', title: 'A study',
    author: [{ family: 'Smith', given: 'John A.' }],
    issued: { 'date-parts': [[2020]] }, 'container-title': 'Nature' },
]
const FORMATTER = createCitationFormatter(ENTRIES, 'apa')

describe('render: citations', () => {
  it('strips frontmatter with or without a formatter', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# Title'
    expect(render(doc)).toContain('<h1>Title</h1>')
    expect(render(doc)).not.toContain('bibliography')
  })

  it('renders formatted citations and a References section', () => {
    const html = render('Blah [@smith2020].', { formatter: FORMATTER })
    expect(html).toContain('Smith')
    expect(html).toContain('2020')
    expect(html).toContain('<h2>References</h2>')
    expect(html).toContain('csl-entry')
  })

  it('renders raw citation text without a formatter, no References', () => {
    const html = render('Blah [@smith2020].')
    expect(html).toContain('[@smith2020]')
    expect(html).not.toContain('References')
  })

  it('renders unknown keys as in-place errors, rest of doc fine', () => {
    const html = render('Good [@smith2020]. Bad [@nope2000].', { formatter: FORMATTER })
    expect(html).toContain('cite-error')
    expect(html).toContain('[@nope2000?]')
    expect(html).toMatch(/Smith.*2020/)
  })

  it('adds no References section when the document has no citations', () => {
    expect(render('Just text.', { formatter: FORMATTER })).not.toContain('References')
  })

  it('renders documents without citations identically to the plain pipeline', () => {
    const doc = '# H\n\nSome *text* with $x^2$ and\n\n```vega-lite\n{"mark": "bar"}\n```\n'
    expect(render(doc, { formatter: FORMATTER })).toBe(render(doc))
  })
})
