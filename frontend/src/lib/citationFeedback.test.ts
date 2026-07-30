import { describe, it, expect } from 'vitest'
import {
  extractCitationKeys,
  unresolvedInsertionMessage,
  unsavedBibliographyMessage,
} from './citationFeedback'

describe('extractCitationKeys', () => {
  it('reads a single bracketed key', () => {
    expect(extractCitationKeys('[@smith2020]')).toEqual(['smith2020'])
  })

  it('reads every key in a multi-cite group', () => {
    expect(extractCitationKeys('[@smith2020; @doe2021]')).toEqual(['smith2020', 'doe2021'])
  })

  it('ignores prefixes and locators', () => {
    expect(extractCitationKeys('[see @smith2020, pp. 33-35]')).toEqual(['smith2020'])
  })

  it('reads a narrative citation', () => {
    expect(extractCitationKeys('@smith2020')).toEqual(['smith2020'])
  })

  it('returns nothing for text that is not a citation', () => {
    expect(extractCitationKeys('mail me at test@example.com')).toEqual([])
    expect(extractCitationKeys('')).toEqual([])
  })
})

describe('unresolvedInsertionMessage', () => {
  const has = (key: string) => key === 'known2020'

  it('is silent when every inserted key resolves', () => {
    expect(unresolvedInsertionMessage('[@known2020]', has, 'refs.bib')).toBeNull()
  })

  it('names the single missing key and the bibliography file', () => {
    const msg = unresolvedInsertionMessage('[@missing1999]', has, 'refs.bib')
    expect(msg).toContain('missing1999')
    expect(msg).toContain('refs.bib')
  })

  it('names every missing key when several are missing', () => {
    const msg = unresolvedInsertionMessage('[@missing1999; @absent2001]', has, 'refs.bib')
    expect(msg).toContain('missing1999')
    expect(msg).toContain('absent2001')
  })

  it('reports only the missing keys from a mixed group', () => {
    const msg = unresolvedInsertionMessage('[@known2020; @missing1999]', has, 'refs.bib')
    expect(msg).toContain('missing1999')
    expect(msg).not.toContain('known2020')
  })

  it('is silent when there is no bibliography to check against', () => {
    expect(unresolvedInsertionMessage('[@anything]', has, null)).toBeNull()
  })

  it('is silent when the insertion contains no citation', () => {
    expect(unresolvedInsertionMessage('', has, 'refs.bib')).toBeNull()
  })
})

describe('unsavedBibliographyMessage', () => {
  it('explains that an unsaved document cannot resolve its bibliography', () => {
    const msg = unsavedBibliographyMessage('refs.bib', null)
    expect(msg).toContain('refs.bib')
    expect(msg).toMatch(/save/i)
  })

  it('is silent once the document has a path', () => {
    expect(unsavedBibliographyMessage('refs.bib', '/tmp/paper.md')).toBeNull()
  })

  it('is silent when the document names no bibliography', () => {
    expect(unsavedBibliographyMessage(undefined, null)).toBeNull()
  })
})
