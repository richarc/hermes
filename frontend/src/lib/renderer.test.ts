import { describe, it, expect } from 'vitest'
import { render } from './renderer'

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
