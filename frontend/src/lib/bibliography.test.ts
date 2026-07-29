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
})
