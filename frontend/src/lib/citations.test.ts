import { describe, it, expect } from 'vitest'
import { createCitationFormatter, STYLE_IDS } from './citations'
import type { CSLEntry } from './bibliography'

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
})
