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

  it('strips an empty frontmatter block', () => {
    expect(parseFrontmatter('---\n---\n# Title').body).toBe('# Title')
  })

  it('parses a block written with CRLF line endings', () => {
    const doc = '---\r\nbibliography: refs.bib\r\ncsl: ieee\r\n---\r\n# Title\r\n'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBe('refs.bib')
    expect(fm.csl).toBe('ieee')
    expect(fm.body).toBe('# Title\r\n')
  })

  it('handles an unterminated CRLF block as plain text', () => {
    const doc = '---\r\nbibliography: refs.bib\r\nno closing fence'
    expect(parseFrontmatter(doc).body).toBe(doc)
  })

  it('does not accept a longer run of dashes as the closing fence', () => {
    const doc = '---\ncsl: apa\n----\nstill inside\n---\nreal body'
    const fm = parseFrontmatter(doc)
    expect(fm.csl).toBe('apa')
    expect(fm.body).toBe('real body')
  })

  it('handles an unterminated frontmatter block as plain text', () => {
    const doc = '---\nbibliography: refs.bib\nno closing fence'
    expect(parseFrontmatter(doc).body).toBe(doc)
  })
})

describe('bodyStartLine', () => {
  it('is 1 when there is no frontmatter', () => {
    expect(parseFrontmatter('# Title\n').bodyStartLine).toBe(1)
  })

  it('is the first line after the closing fence', () => {
    // ---(1) bibliography(2) ---(3) → body starts on line 4
    expect(parseFrontmatter('---\nbibliography: r.bib\n---\n# Title\n').bodyStartLine).toBe(4)
  })

  it('counts a multi-line block', () => {
    const src = '---\na: 1\nb: 2\nc: 3\n---\nbody\n'
    expect(parseFrontmatter(src).bodyStartLine).toBe(6)
  })

  it('is 1 for an unterminated block, which is not frontmatter', () => {
    expect(parseFrontmatter('---\nnot closed\n# Title\n').bodyStartLine).toBe(1)
  })
})
