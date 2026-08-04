import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBib } from './bibliography'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const BIB = readFileSync(join(__dirname, 'fixtures/test-library.bib'), 'utf8')

describe('parseBib', () => {
  const { entries, warnings } = parseBib(BIB)
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]))

  it('parses all entries without warnings', () => {
    expect(entries.length).toBe(5)
    expect(warnings).toEqual([])
  })

  it('maps an article with authors, container, pages, volume, issue, DOI', () => {
    const e = byId['smith2020']
    expect(e.type).toBe('article-journal')
    expect(e.author).toEqual([
      { family: 'Smith', given: 'John A.' },
      { family: 'Doe', given: 'Jane' },
    ])
    expect(e['container-title']).toBe('Nature')
    expect(e.issued).toEqual({ 'date-parts': [[2020]] })
    expect(e.page).toMatch(/10[-–]20/)
    expect(e.volume).toBe('5')
    expect(e.issue).toBe('2')
    expect(e.DOI).toBe('10.1000/xyz')
  })

  it('maps book, chapter, and conference types', () => {
    expect(byId['doe2021'].type).toBe('book')
    expect(byId['doe2021'].publisher).toBe('Acme Press')
    expect(byId['doe2021']['publisher-place']).toBe('Boston')
    expect(byId['smith2020b'].type).toBe('chapter')
    expect(byId['smith2020b']['container-title']).toBe('Collected studies')
    expect(byId['jones2019'].type).toBe('paper-conference')
  })

  it('maps a corporate author to a literal name', () => {
    expect(byId['websource2022'].author).toEqual([{ literal: 'Acme Corporation' }])
    expect(byId['websource2022'].URL).toBe('https://example.com/report')
  })

  it('reports malformed input as warnings, keeping good entries', () => {
    const r = parseBib('@article{ok, title={Fine}, year={2020}}\n@article{broken')
    expect(r.entries.map((e) => e.id)).toContain('ok')
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  // The parser emulates LaTeX's OT1 text encoding, where a bare `<` typesets
  // as `¡` and `>` as `¿`. That is faithful to LaTeX and wrong for a title
  // someone wrote meaning less-than.
  describe('angle brackets in field values', () => {
    const title = (bib: string) => parseBib(bib).entries[0]?.title

    it('keeps < and > written literally in a title', () => {
      expect(
        title('@article{k, title = {Alloys at <5 and >100 degrees}, year={2021}}'),
      ).toBe('Alloys at <5 and >100 degrees')
    })

    it('keeps them in every other extracted field', () => {
      const e = parseBib(
        '@article{k, journal = {J. of <Things>}, publisher = {A<B>C}, year={2021}}',
      ).entries[0]
      expect(e['container-title']).toBe('J. of <Things>')
      expect(e.publisher).toBe('A<B>C')
    })

    it('keeps them in a literal author name', () => {
      expect(
        parseBib('@article{k, author = {{<Institute> of Things}}, year={2021}}')
          .entries[0]?.author,
      ).toEqual([{ literal: '<Institute> of Things' }])
    })

    it('leaves genuine inverted marks alone', () => {
      // The naive fix — mapping ¡ and ¿ back afterwards — would corrupt this.
      expect(title('@article{k, title = {¿Qué pasa? ¡Vaya!}, year={2021}}')).toBe(
        '¿Qué pasa? ¡Vaya!',
      )
    })

    it('still handles comparisons written the LaTeX way, in math mode', () => {
      expect(title('@article{k, title = {Alloys at $<5$ degrees}, year={2021}}')).toBe(
        'Alloys at <5 degrees',
      )
    })

    it('still converts LaTeX markup and accents', () => {
      expect(title('@article{k, title = {A \\textbf{bold} claim}, year={2021}}')).toContain(
        '<b>bold</b>',
      )
      // Normalised: the parser emits combining accents, not precomposed ones.
      expect(title('@article{k, title = {Caf\\\'e r\\^ole}, year={2021}}')?.normalize('NFC')).toBe(
        'Café rôle'.normalize('NFC'),
      )
    })
  })

  it('filters out phantom entries with empty keys from parser recovery', () => {
    const r = parseBib('@article{ok, title={Fine}, year={2020}}\n@article{broken')
    expect(r.entries.length).toBe(1)
    expect(r.entries[0].id).toBe('ok')
    expect(r.warnings.length).toBeGreaterThan(0)
    // Ensure no entry has empty id
    expect(r.entries.every((e) => e.id && e.id.length > 0)).toBe(true)
  })
})
