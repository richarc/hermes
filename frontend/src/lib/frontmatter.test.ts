import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from './frontmatter'

describe('parseFrontmatter', () => {
  it('extracts bibliography and csl and strips the block', () => {
    const doc = '---\nbibliography: refs.bib\ncsl: ieee\n---\n# Title\n'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBe('refs.bib')
    expect(fm.csl).toBe('ieee')
    expect(fm.body).toBe('# Title\n')
  })

  it('handles quoted values and extra whitespace', () => {
    const doc = '---\nbibliography:  "my refs.bib"\n---\nText'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBe('my refs.bib')
  })

  it('ignores unknown keys but still strips the block', () => {
    const doc = '---\ntitle: My Paper\n---\nText'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.body).toBe('Text')
  })

  it('returns the document unchanged when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just a doc').body).toBe('# Just a doc')
  })

  it('does not treat a mid-document --- as frontmatter', () => {
    const doc = 'Intro\n\n---\nbibliography: x.bib\n---\n'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.body).toBe(doc)
  })

  it('handles an unterminated frontmatter block as plain text', () => {
    const doc = '---\nbibliography: refs.bib\nno closing fence'
    expect(parseFrontmatter(doc).body).toBe(doc)
  })
})
