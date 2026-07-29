import { describe, it, expect } from 'vitest'
import { createCitationFormatter, STYLE_IDS } from './citations'
import type { CSLEntry } from './bibliography'
import MarkdownIt from 'markdown-it'
import { citationPlugin } from './citations'
import type { CitationCluster } from './citations'

const ENTRIES: CSLEntry[] = [
  { id: 'smith2020', type: 'article-journal', title: 'A study',
    author: [{ family: 'Smith', given: 'John A.' }],
    issued: { 'date-parts': [[2020]] }, 'container-title': 'Nature' },
  { id: 'doe2021', type: 'book', title: 'Deep work',
    author: [{ family: 'Doe', given: 'Jane' }],
    issued: { 'date-parts': [[2021]] }, publisher: 'Acme' },
  { id: 'smith2020x', type: 'article-journal', title: 'Another study',
    author: [{ family: 'Smith', given: 'John A.' }],
    issued: { 'date-parts': [[2020]] }, 'container-title': 'Science' },
]

describe('createCitationFormatter (apa)', () => {
  it('formats a simple cluster and a multi-cite cluster', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const { texts, bibliographyHtml } = f.format([
      { items: [{ key: 'smith2020' }] },
      { items: [{ key: 'smith2020' }, { key: 'doe2021' }] },
    ])
    expect(texts[0]).toContain('Smith')
    expect(texts[1]).toContain('Doe')
    expect(bibliographyHtml).toContain('csl-entry')
    expect(bibliographyHtml).toContain('csl-bib-body')
  })

  it('renders narrative, suppressed, and locator forms', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const { texts } = f.format([
      { items: [{ key: 'smith2020' }], mode: 'composite' },
      { items: [{ key: 'smith2020', suppressAuthor: true }] },
      { items: [{ key: 'smith2020', prefix: 'see ', locator: '33', label: 'page' }] },
    ])
    expect(texts[0]).toMatch(/Smith \(2020[a-z]?\)/)
    expect(texts[1]).toMatch(/\(2020[a-z]?\)/)
    expect(texts[2]).toContain('see Smith')
    expect(texts[2]).toContain('p. 33')
  })

  it('disambiguates two same-author-same-year entries', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const { texts } = f.format([
      { items: [{ key: 'smith2020' }] },
      { items: [{ key: 'smith2020x' }] },
    ])
    expect(texts[0]).not.toBe(texts[1]) // 2020a vs 2020b
  })

  it('returns empty bibliography for zero clusters', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    expect(f.format([]).bibliographyHtml).toBe('')
  })

  it('every bundled style formats without throwing', () => {
    for (const id of STYLE_IDS) {
      const f = createCitationFormatter(ENTRIES, id)
      expect(f.format([{ items: [{ key: 'doe2021' }] }]).texts[0].length).toBeGreaterThan(0)
    }
  })

  it('unknown style id falls back to apa output', () => {
    const apa = createCitationFormatter(ENTRIES, 'apa').format([{ items: [{ key: 'doe2021' }] }])
    const fb = createCitationFormatter(ENTRIES, 'nope').format([{ items: [{ key: 'doe2021' }] }])
    expect(fb.texts[0]).toBe(apa.texts[0])
  })

  it('keeps index alignment when an empty-items cluster precedes a real one', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const { texts, bibliographyHtml } = f.format([
      { items: [{ key: 'smith2020' }] },
      { items: [] },
      { items: [{ key: 'doe2021' }] },
    ])
    expect(texts[0]).toContain('Smith')
    expect(texts[1]).toBe('')
    expect(texts[2]).toContain('Doe')
    expect(bibliographyHtml).toContain('Smith')
    expect(bibliographyHtml).toContain('Doe')
  })
})

function parseDoc(src: string): { html: string; clusters: CitationCluster[] } {
  const md = new MarkdownIt({ html: false })
  md.use(citationPlugin)
  const env: { citations?: CitationCluster[] } = {}
  const html = md.render(src, env)
  return { html, clusters: env.citations ?? [] }
}

describe('citationPlugin parsing', () => {
  it('parses a simple bracketed citation into a placeholder + cluster', () => {
    const { html, clusters } = parseDoc('As shown [@smith2020].')
    expect(html).toContain('data-cite-index="0"')
    expect(clusters).toEqual([{ items: [{ key: 'smith2020' }] }])
  })

  it('parses multiple keys with semicolons', () => {
    const { clusters } = parseDoc('[@a2020; @b2021]')
    expect(clusters[0].items.map((i) => i.key)).toEqual(['a2020', 'b2021'])
  })

  it('parses prefix, locator, and label', () => {
    const { clusters } = parseDoc('[see @smith2020, pp. 33-35]')
    expect(clusters[0].items[0]).toMatchObject({
      key: 'smith2020', prefix: 'see ', locator: '33-35', label: 'page',
    })
  })

  it('parses suppress-author', () => {
    const { clusters } = parseDoc('Smith said blah [-@smith2020].')
    expect(clusters[0].items[0].suppressAuthor).toBe(true)
  })

  it('parses a narrative citation as composite mode', () => {
    const { clusters } = parseDoc('@smith2020 shows the effect.')
    expect(clusters[0]).toMatchObject({ items: [{ key: 'smith2020' }], mode: 'composite' })
  })

  it('does not fire on emails or mid-word @', () => {
    const { clusters, html } = parseDoc('mail me at test@example.com')
    expect(clusters).toEqual([])
    expect(html).toContain('test@example.com')
  })

  it('leaves normal links and brackets alone', () => {
    const { clusters, html } = parseDoc('[a link](https://x.y) and [plain brackets]')
    expect(clusters).toEqual([])
    expect(html).toContain('<a href')
  })

  it('does not fire inside code spans', () => {
    const { clusters } = parseDoc('`[@smith2020]`')
    expect(clusters).toEqual([])
  })

  it('numbers clusters in document order', () => {
    const { html, clusters } = parseDoc('[@a1] then @b2 then [@c3]')
    expect(clusters.length).toBe(3)
    expect(html).toContain('data-cite-index="1"')
    expect(html).toContain('data-cite-index="2"')
  })
})
