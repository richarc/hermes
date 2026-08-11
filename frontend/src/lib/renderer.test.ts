import { describe, it, expect } from 'vitest'
import { render } from './renderer'
import { createCitationFormatter } from './citations'
import { parseBib, type CSLEntry } from './bibliography'

describe('render: markdown', () => {
  it('renders headings', () => {
    expect(render('# Introduction')).toMatch(/<h1[^>]*>Introduction<\/h1>/)
  })

  it('renders emphasis and paragraphs', () => {
    const html = render('Some *emphasised* text')
    expect(html).toMatch(/<p[^>]*>/)
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

describe('render: chart width', () => {
  const fence = (spec: string) => '```vega-lite\n' + spec + '\n```'

  it('injects the default medium width when the spec declares none', () => {
    const html = render(fence('{"mark":"bar"}'))
    expect(html).toContain('&quot;width&quot;:400')
  })

  it('injects the requested width', () => {
    expect(render(fence('{"mark":"bar"}'), { chartWidth: 'small' })).toContain(
      '&quot;width&quot;:240',
    )
    expect(render(fence('{"mark":"bar"}'), { chartWidth: 'large' })).toContain(
      '&quot;width&quot;:560',
    )
  })

  it("leaves an author's explicit width alone", () => {
    const html = render(fence('{"mark":"bar","width":300}'), { chartWidth: 'large' })
    expect(html).toContain('&quot;width&quot;:300')
    expect(html).not.toContain('560')
  })

  it('passes unparseable spec text through untouched', () => {
    const html = render(fence('not json'))
    expect(html).toContain('not json')
    expect(html).not.toContain('width')
  })

  it('passes a spec that is not a JSON object through untouched', () => {
    const html = render(fence('[1, 2]'))
    expect(html).toContain('[1, 2]')
    expect(html).not.toContain('width')
  })
})

const ENTRIES: CSLEntry[] = [
  { id: 'smith2020', type: 'article-journal', title: 'A study',
    author: [{ family: 'Smith', given: 'John A.' }],
    issued: { 'date-parts': [[2020]] }, 'container-title': 'Nature' },
]
// Top-level await: the formatter now loads its style and engine on demand, and
// every test below wants the same ready-made one.
const FORMATTER = await createCitationFormatter(ENTRIES, 'apa')

describe('render: citations', () => {
  it('strips frontmatter with or without a formatter', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# Title'
    expect(render(doc)).toMatch(/<h1[^>]*>Title<\/h1>/)
    expect(render(doc)).not.toContain('bibliography')
  })

  it('renders formatted citations and a References section', () => {
    const html = render('Blah [@smith2020].', { formatter: FORMATTER })
    expect(html).toContain('Smith')
    expect(html).toContain('2020')
    expect(html).toMatch(/<h2 data-source-line="\d+">References<\/h2>/)
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

  it('escapes HTML-significant characters in an unresolvable citekey', () => {
    const html = render('Weird [@bad&x<y>z].', { formatter: FORMATTER })
    expect(html).toContain('cite-error')
    expect(html).toContain('&amp;x&lt;y&gt;z?')
    expect(html).not.toContain('<y>')
  })

  it('strips CRLF frontmatter and still resolves citations', () => {
    const doc = '---\r\nbibliography: refs.bib\r\n---\r\n# Title\r\n\r\nBlah [@smith2020].'
    const html = render(doc, { formatter: FORMATTER })
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/)
    expect(html).not.toContain('bibliography')
    expect(html).toContain('Smith')
  })

  it('formats a citation group that wraps across a line break', () => {
    const html = render('Blah [see @smith2020,\np. 33].', { formatter: FORMATTER })
    expect(html).not.toContain('data-cite-index')
    expect(html).toContain('see Smith')
    expect(html).toContain('p. 33')
  })

  it('reports an unresolvable wrapped citation group as an in-place error', () => {
    const html = render('Blah [@nope2000;\n@alsonope].', { formatter: FORMATTER })
    expect(html).not.toContain('data-cite-index')
    expect(html).toContain('cite-error')
  })

  it('adds no References section when the document has no citations', () => {
    expect(render('Just text.', { formatter: FORMATTER })).not.toContain('References')
  })

  it('renders documents without citations identically to the plain pipeline', () => {
    const doc = '# H\n\nSome *text* with $x^2$ and\n\n```vega-lite\n{"mark": "bar"}\n```\n'
    expect(render(doc, { formatter: FORMATTER })).toBe(render(doc))
  })
})

// A .bib is third-party content: it can arrive with a downloaded paper, and
// its fields are interpolated into HTML that Preview.svelte assigns straight
// to innerHTML. Angle brackets now reach citeproc intact (they used to be
// mangled into ¡ and ¿ before ever getting there), so these pin the escaping
// that keeps that safe.
describe('render: bibliography content never becomes live markup', () => {
  const bib = (title: string) =>
    `@article{k, title = {${title}}, author = {Frost, Ann}, year = {2021}}`

  it('escapes tags and comparison operators from a field', async () => {
    const { entries } = parseBib(bib('Pwned <img src=x onerror=alert(1)> at <5 degrees'))
    const html = render('Text [@k].', {
      formatter: await createCitationFormatter(entries, 'apa'),
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('&#60;img')
    expect(html).toContain('&#60;5 degrees')
  })

  it('drops event-handler attributes from markup CSL does recognise', async () => {
    const { entries } = parseBib(
      bib('A <span class="nocase" onmouseover="alert(1)">tricky</span> title'),
    )
    const html = render('Text [@k].', {
      formatter: await createCitationFormatter(entries, 'apa'),
    })
    expect(html).not.toContain('onmouseover')
    expect(html).toContain('tricky')
  })
})

describe('mermaid fences', () => {
  it('emits a placeholder carrying the diagram source', () => {
    const html = render('```mermaid\nflowchart LR\n  A --> B\n```\n')
    expect(html).toContain('class="mermaid-diagram"')
    expect(html).toContain('flowchart LR')
  })

  it('anchors the placeholder to its source line for scroll sync', () => {
    const html = render('# Heading\n\n```mermaid\nflowchart LR\n```\n')
    expect(html).toMatch(/<div class="mermaid-diagram" data-source-line="3"/)
  })

  // The title belongs in the caption, and Mermaid would otherwise draw it
  // inside the SVG as well.
  it('strips a frontmatter title out of the source it hands to Mermaid', () => {
    const html = render('```mermaid\n---\ntitle: Stages\n---\nflowchart LR\n```\n')
    expect(html).not.toContain('title: Stages')
    expect(html).toContain('flowchart LR')
  })

  it('leaves a fence of another language to the default renderer', () => {
    const html = render('```js\nconst x = 1\n```\n')
    expect(html).not.toContain('mermaid-diagram')
    expect(html).toContain('language-js')
  })

  it('wraps a titled diagram in a figure with a numbered caption', () => {
    const html = render('```mermaid\n---\ntitle: Stages\n---\nflowchart LR\n```\n')
    expect(html).toContain('<figcaption>Figure 1 — Stages</figcaption>')
    expect(html).toContain('<figure')
  })

  // collectAnchors takes every [data-source-line] as an anchor, and two at
  // different offsets for one source line is a degenerate segment for
  // previewOffsetForLine to interpolate across.
  it('puts the anchor on the figure and not on the diagram inside it', () => {
    const html = render('```mermaid\n---\ntitle: Stages\n---\nflowchart LR\n```\n')
    expect(html).toMatch(/<figure data-source-line="1">/)
    expect(html).toMatch(/<div class="mermaid-diagram" data-source="/)
  })

  it('numbers diagrams, charts and images in one document-order sequence', () => {
    const doc =
      '![A photo](a.png)\n\n' +
      '```mermaid\n---\ntitle: Stages\n---\nflowchart LR\n```\n\n' +
      '```vega-lite\n{"title": "A chart", "mark": "line"}\n```\n'
    const html = render(doc)
    expect(html).toContain('Figure 1 — A photo')
    expect(html).toContain('Figure 2 — Stages')
    expect(html).toContain('Figure 3 — A chart')
  })

  it('leaves an untitled diagram unnumbered and unwrapped', () => {
    const html = render('```mermaid\nflowchart LR\n```\n')
    expect(html).not.toContain('<figure')
    expect(html).not.toContain('figcaption')
  })
})

describe('render: source-line anchors', () => {
  it('stamps every top-level block with its 1-based source line', () => {
    const html = render('# Title\n\nPara.\n\n| a |\n|---|\n| 1 |\n')
    expect(html).toContain('<h1 data-source-line="1"')
    expect(html).toContain('<p data-source-line="3"')
    expect(html).toContain('<table data-source-line="5"')
  })

  it('stamps vega-lite chart placeholders, which build their own HTML', () => {
    const html = render('Intro.\n\n```vega-lite\n{"mark":"bar"}\n```\n')
    expect(html).toContain('class="vega-lite-chart"')
    expect(html).toMatch(/<div class="vega-lite-chart" data-source-line="3"/)
  })

  it('offsets anchors past the frontmatter, so they match editor lines', () => {
    // ---(1) csl(2) ---(3) blank(4) # Title(5)
    const html = render('---\ncsl: apa\n---\n\n# Title\n')
    expect(html).toContain('<h1 data-source-line="5"')
  })

  it('keeps anchors out of inline content', () => {
    const html = render('Some *emphasis* here.\n')
    expect(html).toContain('<p data-source-line="1"')
    expect(html).not.toContain('<em data-source-line')
  })

  it('stamps display math blocks, which the katex plugin renders by hand', () => {
    const html = render('Intro.\n\n$$\\int_0^1 x\\,dx$$\n')
    expect(html).toMatch(/<p data-source-line="3"[^>]*class="katex-block"/)
  })

  it('stamps the References heading with the document line count', () => {
    const doc = 'Blah [@smith2020].\n'
    const html = render(doc, { formatter: FORMATTER })
    const lines = doc.split(/\r\n?|\n/).length
    expect(html).toContain(`<h2 data-source-line="${lines}">References</h2>`)
  })
})
