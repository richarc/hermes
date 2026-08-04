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

  // A formatter is reused across every preview render, so each format() call
  // must see a processor with no memory of the last one. These pin the two
  // ways leaked state would surface.
  it('returns identical output when the same clusters are formatted twice', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const clusters: CitationCluster[] = [
      { items: [{ key: 'smith2020' }] },
      { items: [{ key: 'smith2020' }, { key: 'doe2021' }] },
      { items: [{ key: 'smith2020' }], mode: 'composite' },
    ]
    expect(f.format(clusters)).toEqual(f.format(clusters))
  })

  it('drops an entry from the bibliography once its citation is gone', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    f.format([{ items: [{ key: 'smith2020' }] }, { items: [{ key: 'doe2021' }] }])
    // The user deleted the Doe citation: the reference must go with it.
    const after = f.format([{ items: [{ key: 'smith2020' }] }])
    expect(after.bibliographyHtml).toContain('Smith')
    expect(after.bibliographyHtml).not.toContain('Doe')
  })

  it('re-disambiguates when a colliding citation is added and removed', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const alone = f.format([{ items: [{ key: 'smith2020' }] }]).texts[0]
    const collided = f.format([
      { items: [{ key: 'smith2020' }] },
      { items: [{ key: 'smith2020x' }] },
    ]).texts[0]
    expect(collided).not.toBe(alone) // gains the 2020a suffix
    // ...and loses it again when the colliding entry is no longer cited.
    expect(f.format([{ items: [{ key: 'smith2020' }] }]).texts[0]).toBe(alone)
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

describe('citationPlugin does not hijack markdown links (regression)', () => {
  it('an @-word inside an inline link label leaves the link intact', () => {
    // The outer `[...](url)` has no nested bracket construct, so it's a
    // normal link; a bare `@cite` inside link text is not treated as a
    // narrative citation (only the bracketed form nests inside links).
    const { html, clusters } = parseDoc('[my @cite here](https://example.com)')
    expect(html).toContain('<a href="https://example.com">my @cite here</a>')
    expect(clusters).toEqual([])
  })

  it('a bracketed citation nested inside a link label still parses, per CommonMark link-in-link rules', () => {
    // Per CommonMark (spec example: `[foo [bar](/uri)](/uri)`), a link label
    // containing another bracket-consuming construct disqualifies the OUTER
    // brackets from being a link -- they render as literal text -- while the
    // inner construct still renders normally. Our citation span is one such
    // construct, so `[a [@cite] link](url)` behaves the same way a literal
    // nested link would: outer brackets/parens stay literal, inner citation
    // renders.
    const { html, clusters } = parseDoc('[a [@cite] link](https://example.com)')
    expect(clusters).toEqual([{ items: [{ key: 'cite' }] }])
    expect(html).toContain('data-cite-index="0"')
    expect(html).toContain('>[@cite]<') // placeholder span wraps the raw "[@cite]" text
    expect(html).not.toContain('<a href')
  })

  it('an @-word inside a reference-style link label leaves the link intact', () => {
    const { html, clusters } = parseDoc(
      '[see @smith][ref]\n\n[ref]: https://example.com',
    )
    expect(html).toContain('<a href="https://example.com">see @smith</a>')
    expect(clusters).toEqual([])
  })

  it('an unclosed bracket never absorbs later content, and does not fall back to a bare citation', () => {
    const { html, clusters } = parseDoc('Note [@key\nsome [text] after')
    expect(clusters).toEqual([])
    expect(html).toContain('Note [@key')
    expect(html).toContain('some [text] after')
  })
})

describe('citationPlugin: adjacent brackets and declined links (round-2 fix)', () => {
  it('two adjacent bracketed citations both parse -- the second is not swallowed as a bogus reference label', () => {
    // `link` tries `[@a2020]` first: no `(` follows, and `[@b2021]` doesn't
    // resolve as a reference (no definition), so `link` declines and
    // `bracketRule` (registered right after it) gets both brackets in turn.
    const { html, clusters } = parseDoc('[@a2020][@b2021]')
    expect(clusters.map((c) => c.items.map((i) => i.key))).toEqual([['a2020'], ['b2021']])
    expect(html).toContain('data-cite-index="0"')
    expect(html).toContain('data-cite-index="1"')
  })

  it('a citation followed by an undefined reference label keeps the citation and leaves the label literal', () => {
    // `link` attempts the `[text][label]` reference form using
    // "TODO check" as the label; since no such reference is defined, `link`
    // declines the whole thing (not just the label) rather than silently
    // eating `[@smith2020]`. `bracketRule` then still gets a turn at
    // `[@smith2020]` and parses it; `[TODO check]` has no `@`, so it's left
    // as literal text.
    const { html, clusters } = parseDoc('See [@smith2020][TODO check]')
    expect(clusters).toEqual([{ items: [{ key: 'smith2020' }] }])
    expect(html).toContain('data-cite-index="0"')
    expect(html).toContain('[TODO check]')
    expect(html).not.toContain('<a href')
  })
})
