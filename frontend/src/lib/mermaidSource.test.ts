import { describe, it, expect } from 'vitest'
import { parseMermaidSource } from './mermaidSource'

describe('parseMermaidSource', () => {
  it('reports no title and returns the source untouched when there is no frontmatter', () => {
    const text = 'flowchart LR\n  A --> B\n'
    expect(parseMermaidSource(text)).toEqual({ title: '', body: text })
  })

  it('reads a plain title and removes the whole block when that was all it held', () => {
    const text = '---\ntitle: Pipeline stages\n---\nflowchart LR\n  A --> B\n'
    expect(parseMermaidSource(text)).toEqual({
      title: 'Pipeline stages',
      body: 'flowchart LR\n  A --> B\n',
    })
  })

  it('unquotes a double-quoted title', () => {
    const text = '---\ntitle: "Pipeline stages"\n---\nflowchart LR\n'
    expect(parseMermaidSource(text).title).toBe('Pipeline stages')
  })

  it('unquotes a single-quoted title', () => {
    const text = "---\ntitle: 'Pipeline stages'\n---\nflowchart LR\n"
    expect(parseMermaidSource(text).title).toBe('Pipeline stages')
  })

  // The trap this exists to avoid: taking the whole frontmatter block with the
  // title would silently drop `config`, changing how the diagram renders. The
  // same care rewriteChartSpec takes in deleting only `text` from a title
  // object and keeping the rest.
  it('removes only the title line, leaving the rest of the frontmatter intact', () => {
    const text =
      '---\ntitle: Pipeline stages\nconfig:\n  theme: forest\n---\nflowchart LR\n'
    expect(parseMermaidSource(text)).toEqual({
      title: 'Pipeline stages',
      body: '---\nconfig:\n  theme: forest\n---\nflowchart LR\n',
    })
  })

  it('keeps a frontmatter block that carries no title at all', () => {
    const text = '---\nconfig:\n  theme: forest\n---\nflowchart LR\n'
    expect(parseMermaidSource(text)).toEqual({ title: '', body: text })
  })

  // Only a TOP-LEVEL title is Mermaid's title. An indented one belongs to
  // whatever key encloses it, and taking it would both invent a caption and
  // corrupt that block.
  it('ignores an indented title nested under another key', () => {
    const text = '---\nconfig:\n  title: not the diagram title\n---\nflowchart LR\n'
    expect(parseMermaidSource(text)).toEqual({ title: '', body: text })
  })

  // Mermaid parses full YAML; this does not. Failing to recognise a title is
  // safe — it stays in the source, Mermaid draws it in the SVG, and the
  // diagram is simply not a numbered figure. Inventing one is not safe.
  it('declines a block scalar rather than reading its marker as the title', () => {
    const text = '---\ntitle: >\n  folded text\n---\nflowchart LR\n'
    expect(parseMermaidSource(text)).toEqual({ title: '', body: text })
  })

  it('declines a flow collection rather than reading its brackets as the title', () => {
    const text = '---\ntitle: [a, b]\n---\nflowchart LR\n'
    expect(parseMermaidSource(text)).toEqual({ title: '', body: text })
  })

  it('declines an empty title', () => {
    const text = '---\ntitle:\n---\nflowchart LR\n'
    expect(parseMermaidSource(text)).toEqual({ title: '', body: text })
  })

  // This is a public function with no "LF only" guard in its contract, so a
  // CRLF frontmatter must be handled correctly regardless of key order.
  it('recognises a title in a CRLF frontmatter block that also carries config', () => {
    const text =
      '---\r\ntitle: Pipeline stages\r\nconfig:\r\n  theme: forest\r\n---\r\nflowchart LR\r\n'
    expect(parseMermaidSource(text)).toEqual({
      title: 'Pipeline stages',
      body: '---\nconfig:\n  theme: forest\n---\nflowchart LR\r\n',
    })
  })

  it('drops a space-preceded comment from an unquoted title', () => {
    const text = '---\ntitle: Run #3\n---\nflowchart LR\n'
    expect(parseMermaidSource(text).title).toBe('Run')
  })

  it('keeps a quoted title verbatim, comment marker and all', () => {
    const text = '---\ntitle: "Run #3"\n---\nflowchart LR\n'
    expect(parseMermaidSource(text).title).toBe('Run #3')
  })

  // Not corruption: an empty block never matches FRONTMATTER, so the author's
  // text is returned byte-for-byte, which is the declared decline behaviour.
  it('passes an empty frontmatter block through unchanged', () => {
    const text = '---\n---\nflowchart LR\n'
    expect(parseMermaidSource(text)).toEqual({ title: '', body: text })
  })
})
