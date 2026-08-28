import { describe, it, expect } from 'vitest'
import { NEW_DOCUMENT_TEMPLATE, BIBLIOGRAPHY_SEED, newDocumentText } from './documentTemplate'
import { parseFrontmatter } from './frontmatter'
import { STYLE_IDS } from './citations'
import { render } from './renderer'

describe('NEW_DOCUMENT_TEMPLATE', () => {
  // The whole point of commenting the keys out: a live `bibliography:` naming
  // a file that does not exist would toast "Bibliography not found" on every
  // new document.
  it('leaves the bibliography and csl keys inert', () => {
    const fm = parseFrontmatter(NEW_DOCUMENT_TEMPLATE)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.csl).toBeUndefined()
  })

  it('renders to nothing, because the frontmatter is stripped', () => {
    expect(render(NEW_DOCUMENT_TEMPLATE).trim()).toBe('')
  })

  it('names every bundled citation style', () => {
    for (const id of STYLE_IDS) {
      expect(NEW_DOCUMENT_TEMPLATE).toContain(id)
    }
  })

  it('ends with a newline, so the cursor lands below the closing fence', () => {
    expect(NEW_DOCUMENT_TEMPLATE.endsWith('---\n')).toBe(true)
  })

  it('stays short enough to delete in one motion', () => {
    expect(NEW_DOCUMENT_TEMPLATE.trimEnd().split('\n').length).toBeLessThanOrEqual(8)
  })
})

describe('newDocumentText', () => {
  it('writes live bibliography and csl keys named after the document', () => {
    const text = newDocumentText('paper', true, 'ieee')
    const fm = parseFrontmatter(text)
    expect(fm.bibliography).toBe('paper.bib')
    expect(fm.csl).toBe('ieee')
    expect(text.endsWith('---\n')).toBe(true)
    expect(render(text).trim()).toBe('')
  })

  it('falls back to the commented template when there is no bibliography', () => {
    expect(newDocumentText('paper', false, 'ieee')).toBe(NEW_DOCUMENT_TEMPLATE)
  })

  it('refuses a style it does not bundle', () => {
    expect(() => newDocumentText('paper', true, 'mla')).toThrow()
  })
})

describe('BIBLIOGRAPHY_SEED', () => {
  it('is a comment only, so parseBib has nothing to warn about', () => {
    for (const line of BIBLIOGRAPHY_SEED.trimEnd().split('\n')) {
      expect(line.startsWith('%')).toBe(true)
    }
    expect(BIBLIOGRAPHY_SEED.endsWith('\n')).toBe(true)
  })
})
