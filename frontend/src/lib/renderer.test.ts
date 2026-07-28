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
