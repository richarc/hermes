import { describe, it, expect } from 'vitest'
import { slugify, tocDepth, buildTocListHtml, type TocItem } from './toc'
import type { OutlineEntry } from './outline'

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('The Results Section')).toBe('the-results-section')
  })

  it('strips punctuation but keeps letters, digits, hyphens, underscores', () => {
    expect(slugify('Fig. 2: what_now — really?')).toBe('fig-2-what_now--really')
  })

  it('keeps accented and non-latin letters', () => {
    expect(slugify('Résumé und Prüfung')).toBe('résumé-und-prüfung')
  })

  it('falls back for a heading with no sluggable characters', () => {
    expect(slugify('!!!')).toBe('heading')
  })
})

describe('tocDepth', () => {
  it('defaults to 3 when absent or malformed or out of range', () => {
    expect(tocDepth(undefined)).toBe(3)
    expect(tocDepth('two')).toBe(3)
    expect(tocDepth('0')).toBe(3)
    expect(tocDepth('7')).toBe(3)
    expect(tocDepth('2.5')).toBe(3)
  })

  it('accepts 1 through 6', () => {
    expect(tocDepth('1')).toBe(1)
    expect(tocDepth('6')).toBe(6)
  })
})

describe('buildTocListHtml', () => {
  const entry = (level: number, text: string, line: number): OutlineEntry => ({ level, text, line })
  const item = (level: number, text: string, slug: string): TocItem => ({
    entry: entry(level, text, 1),
    slug,
  })

  it('renders a flat list of links', () => {
    const html = buildTocListHtml([item(1, 'One', 'one'), item(1, 'Two', 'two')])
    expect(html).toBe(
      '<ul><li><a href="#one">One</a></li><li><a href="#two">Two</a></li></ul>',
    )
  })

  it('nests deeper levels inside their parent item', () => {
    const html = buildTocListHtml([item(1, 'A', 'a'), item(2, 'A1', 'a1'), item(1, 'B', 'b')])
    expect(html).toBe(
      '<ul><li><a href="#a">A</a><ul><li><a href="#a1">A1</a></li></ul></li><li><a href="#b">B</a></li></ul>',
    )
  })

  it('survives a level jump without a parent', () => {
    const html = buildTocListHtml([item(1, 'A', 'a'), item(3, 'Deep', 'deep')])
    expect(html).toContain('<a href="#deep">Deep</a>')
    // Every list that opens closes: the string parses back to balanced tags.
    expect((html.match(/<ul>/g) ?? []).length).toBe((html.match(/<\/ul>/g) ?? []).length)
    expect((html.match(/<li>/g) ?? []).length).toBe((html.match(/<\/li>/g) ?? []).length)
  })

  it('lists a heading shallower than the first at the first level', () => {
    const html = buildTocListHtml([item(2, 'Start', 'start'), item(1, 'Up', 'up')])
    expect(html).toBe('<ul><li><a href="#start">Start</a></li><li><a href="#up">Up</a></li></ul>')
  })

  it('escapes heading text and slugs', () => {
    const html = buildTocListHtml([item(1, 'a <b> & c', 'a-b--c"x')])
    expect(html).toContain('a &lt;b&gt; &amp; c')
    expect(html).not.toContain('"x"')
  })

  it('is empty for no items', () => {
    expect(buildTocListHtml([])).toBe('')
  })
})

// --- renderer integration -------------------------------------------------

import { renderDocument, render } from './renderer'

const TOC_DOC = `---
toc: true
---
# Title Page

# Introduction

Some text.

[[toc]]

# Methods

## Sampling

### Detail level three

#### Level four stays out

# Results
`

describe('heading anchors', () => {
  it('gives every heading a slug id, toc or not', () => {
    const html = render('# One\n\n## Two Words\n')
    expect(html).toMatch(/<h1[^>]*id="one"/)
    expect(html).toMatch(/<h2[^>]*id="two-words"/)
  })

  it('deduplicates repeated headings within one render but not across renders', () => {
    const html = render('# Same\n\n# Same\n')
    expect(html).toContain('id="same"')
    expect(html).toContain('id="same-1"')
    const again = render('# Same\n')
    expect(again).toContain('id="same"')
    expect(again).not.toContain('id="same-1"')
  })
})

describe('table of contents', () => {
  it('renders at the marker, listing only headings after it, to depth 3', () => {
    const { html } = renderDocument(TOC_DOC)
    const nav = /<nav class="toc"[^>]*>.*?<\/nav>/s.exec(html)?.[0] ?? ''
    expect(nav).toContain('<h2>Contents</h2>')
    expect(nav).toContain('href="#methods"')
    expect(nav).toContain('href="#sampling"')
    expect(nav).toContain('href="#detail-level-three"')
    expect(nav).toContain('href="#results"')
    expect(nav).not.toContain('href="#title-page"')
    expect(nav).not.toContain('href="#introduction"')
    expect(nav).not.toContain('level-four')
    // The marker paragraph is gone; the nav stands where it stood, anchored
    // to the marker's own source line for scroll sync.
    expect(html).not.toContain('[[toc]]')
    expect(nav).toMatch(/data-source-line="10"/)
    // The nav sits after Introduction's paragraph and before Methods.
    expect(html.indexOf('Some text.')).toBeLessThan(html.indexOf('<nav'))
    expect(html.indexOf('<nav')).toBeLessThan(html.indexOf('id="methods"'))
  })

  it('renders at the top when there is no marker', () => {
    const { html } = renderDocument('---\ntoc: true\n---\n# One\n\n# Two\n')
    expect(html.startsWith('<nav class="toc" data-source-line="1">')).toBe(true)
    const nav = /<nav class="toc"[^>]*>.*?<\/nav>/s.exec(html)![0]
    expect(nav).toContain('href="#one"')
    expect(nav).toContain('href="#two"')
  })

  it('honours toc-depth', () => {
    const { html } = renderDocument('---\ntoc: true\ntoc-depth: 1\n---\n# One\n\n## Sub\n')
    const nav = /<nav class="toc"[^>]*>.*?<\/nav>/s.exec(html)![0]
    expect(nav).toContain('href="#one"')
    expect(nav).not.toContain('href="#sub"')
  })

  it('treats only the first marker as the position', () => {
    const { html } = renderDocument('---\ntoc: true\n---\n[[toc]]\n\n# One\n\n[[toc]]\n')
    expect((html.match(/<nav class="toc"/g) ?? []).length).toBe(1)
    expect(html).toContain('[[toc]]')
  })

  it('leaves the marker as literal text when toc is off', () => {
    const { html } = renderDocument('# One\n\n[[toc]]\n')
    expect(html).not.toContain('<nav class="toc"')
    expect(html).toContain('[[toc]]')
  })

  it('never treats a marker inside a code fence as a marker', () => {
    const { html } = renderDocument('---\ntoc: true\n---\n```\n[[toc]]\n```\n\n# One\n')
    expect(html).not.toContain('data-source-line="4"><h2>Contents')
    // The fence keeps its text; the ToC falls back to the top.
    expect(html).toContain('[[toc]]')
    expect(html.startsWith('<nav class="toc"')).toBe(true)
  })

  it('does not list the appended References heading', () => {
    // No formatter loaded: the References block only appears with one, so
    // assert on the outline-driven list directly — a heading after the last
    // real line cannot be in it.
    const { html, outline } = renderDocument('---\ntoc: true\n---\n# Only\n')
    expect(outline.map((e) => e.text)).toEqual(['Only'])
    expect(/<nav class="toc"[^>]*>.*?<\/nav>/s.exec(html)![0]).not.toContain('References')
  })
})
