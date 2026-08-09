import { describe, it, expect } from 'vitest'
import { tags } from '@lezer/highlight'
import { CODE_TOKENS, codeHighlightStyleSpecs, codeTagHighlighter } from './syntaxTags'

describe('CODE_TOKENS', () => {
  it('names only palette roles that exist in the stylesheet', () => {
    // Guards the half of the contract CSS cannot: a role here with no
    // --syn-<name> in the palette silently produces an unstyled token.
    expect(CODE_TOKENS.map((r) => r.name).sort()).toEqual([
      'comment',
      'function',
      'keyword',
      'number',
      'string',
      'type',
    ])
  })

  it('resolves every tag it names', () => {
    // A misremembered tag is not a wrong colour, it is `undefined` reaching
    // HighlightStyle.define — so this fails loudly rather than losing a colour.
    for (const role of CODE_TOKENS) {
      for (const tag of role.tags) {
        expect(tag, `a tag in role "${role.name}" did not resolve`).toBeDefined()
      }
    }
  })

  it('maps each tag exactly once', () => {
    // Two roles claiming one tag is a colour decided by array order.
    const all = CODE_TOKENS.flatMap((r) => r.tags)
    expect(new Set(all).size).toBe(all.length)
  })

  it('points every role at a palette variable that exists', () => {
    // `comment` is the one role whose class and colour differ: it takes the
    // markdown `meta` colour. Deriving `var(--syn-comment)` would reference a
    // variable no palette block defines, and nothing in CSS would catch it,
    // because the name is built in TypeScript.
    const defined = ['keyword', 'string', 'number', 'type', 'function', 'meta']
    for (const role of CODE_TOKENS) {
      expect(defined, `role "${role.name}"`).toContain(role.palette ?? role.name)
    }
  })

  it('does not claim markdown\'s own meta tag', () => {
    // Editor.svelte maps tags.meta for frontmatter and markdown punctuation;
    // claiming it here would give one tag two rules.
    const all = new Set(CODE_TOKENS.flatMap((r) => r.tags))
    expect(all.has(tags.meta)).toBe(false)
  })
})

describe('derivations', () => {
  it('gives the editor one spec per tag, coloured from the palette', () => {
    const specs = codeHighlightStyleSpecs()
    expect(specs.length).toBe(CODE_TOKENS.flatMap((r) => r.tags).length)
    for (const s of specs) expect(s.color).toMatch(/^var\(--syn-[a-z]+\)$/)
  })

  it('gives the preview a highlighter', () => {
    expect(typeof codeTagHighlighter().style).toBe('function')
  })

  it('colours the comment role from --syn-meta, not a variable that does not exist', () => {
    // The override only matters if the DERIVATION honours it. Asserting the
    // table's own `palette` field, as the test above does, passes just as
    // happily when codeHighlightStyleSpecs ignores it — verified by mutation.
    const spec = codeHighlightStyleSpecs().find((s) => s.tag === tags.comment)
    expect(spec?.color).toBe('var(--syn-meta)')
  })
})
