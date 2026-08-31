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
