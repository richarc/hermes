import { describe, it, expect } from 'vitest'
import { renderDocument } from './renderer'

describe('outline', () => {
  it('lists headings with level, text and line, in document order', () => {
    const { outline } = renderDocument('# Title\n\ntext\n\n## Method\n\n### Detail\n\n## Results\n')
    expect(outline).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Method', line: 5 },
      { level: 3, text: 'Detail', line: 7 },
      { level: 2, text: 'Results', line: 9 },
    ])
  })

  it('counts lines from the top of the file, frontmatter included', () => {
    const { outline } = renderDocument('---\ncsl: apa\n---\n\n# After frontmatter\n')
    expect(outline).toEqual([{ level: 1, text: 'After frontmatter', line: 5 }])
  })

  it('flattens emphasis, code, links and maths to their words', () => {
    const { outline } = renderDocument('## The **bold** `code` [link](https://x) and $E=mc^2$\n')
    expect(outline[0].text).toBe('The bold code link and E=mc^2')
  })

  it('ignores headings inside fences and blockquotes', () => {
    const { outline } = renderDocument('# Real\n\n```text\n# Not a heading\n```\n\n> # Quoted\n')
    expect(outline).toEqual([{ level: 1, text: 'Real', line: 1 }])
  })

  it('includes setext headings', () => {
    const { outline } = renderDocument('Title\n=====\n\nSub\n---\n')
    expect(outline).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Sub', line: 4 },
    ])
  })

  it('is empty for a document with no headings', () => {
    expect(renderDocument('just prose\n').outline).toEqual([])
    expect(renderDocument('').outline).toEqual([])
  })
})
