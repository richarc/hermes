import { describe, it, expect } from 'vitest'
import {
  NEW_DOCUMENT_TEMPLATE,
  BIBLIOGRAPHY_SEED,
  newDocumentText,
  bibliographyReference,
  withBibExtension,
} from './documentTemplate'
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
  it('writes live bibliography and csl keys from the given reference', () => {
    const text = newDocumentText('paper.bib', 'ieee')
    const fm = parseFrontmatter(text)
    expect(fm.bibliography).toBe('paper.bib')
    expect(fm.csl).toBe('ieee')
    expect(text.endsWith('---\n')).toBe(true)
    expect(render(text).trim()).toBe('')
  })

  it('writes an absolute reference as given', () => {
    const fm = parseFrontmatter(newDocumentText('/Users/a/Library/refs.bib', 'apa'))
    expect(fm.bibliography).toBe('/Users/a/Library/refs.bib')
  })

  it('falls back to the commented template when there is no bibliography', () => {
    expect(newDocumentText(null, 'ieee')).toBe(NEW_DOCUMENT_TEMPLATE)
  })

  it('refuses a style it does not bundle', () => {
    expect(() => newDocumentText('paper.bib', 'mla')).toThrow()
  })
})

describe('bibliographyReference', () => {
  it('is the bare name for a file in the document folder', () => {
    expect(bibliographyReference('/Users/a/paper/refs.bib', '/Users/a/paper/paper.md')).toBe('refs.bib')
  })

  it('is a relative path for a file below the document folder', () => {
    expect(bibliographyReference('/Users/a/paper/lib/refs.bib', '/Users/a/paper/paper.md')).toBe(
      'lib/refs.bib',
    )
  })

  it('is absolute for a file anywhere else', () => {
    expect(bibliographyReference('/Users/a/Library/refs.bib', '/Users/a/paper/paper.md')).toBe(
      '/Users/a/Library/refs.bib',
    )
  })

  it('does not treat a sibling folder with the same prefix as inside', () => {
    expect(bibliographyReference('/Users/a/paper2/refs.bib', '/Users/a/paper/paper.md')).toBe(
      '/Users/a/paper2/refs.bib',
    )
  })
})

describe('withBibExtension', () => {
  it('appends .bib when missing and trims', () => {
    expect(withBibExtension('  references ')).toBe('references.bib')
  })

  it('leaves an existing .bib alone, case-insensitively', () => {
    expect(withBibExtension('refs.bib')).toBe('refs.bib')
    expect(withBibExtension('refs.BIB')).toBe('refs.BIB')
  })

  it('is empty for an empty name', () => {
    expect(withBibExtension('   ')).toBe('')
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
