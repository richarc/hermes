// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { markdown } from '@codemirror/lang-markdown'
import type { Parser } from '@lezer/common'
import { createCodeHydrator, type LoadGrammar } from './codeHighlight'

/**
 * A real parser, from the one grammar package this project depends on
 * directly. Reaching for `@codemirror/lang-python` through language-data
 * would be a transitive import — the thing that broke seven tests when it was
 * done with @codemirror/commands.
 */
const markdownParser: Parser = markdown().language.parser

function containerWith(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

const block = (lang: string, code: string) =>
  `<pre><code data-source-line="1" class="language-${lang}">${code}</code></pre>`

describe('createCodeHydrator', () => {
  it('replaces a code block\'s text with tagged spans', async () => {
    const load: LoadGrammar = vi.fn(async () => markdownParser)
    // A heading alone tags nothing CODE_TOKENS claims — headings, emphasis,
    // and links are markdown's own tags, deliberately left uncoloured
    // (syntaxTags.test.ts pins that CODE_TOKENS must not claim tags.meta,
    // which Editor.svelte already owns). A link title does resolve, via
    // markdown's own highlight config mapping LinkTitle to tags.string and
    // the bare URL to tags.number (both are CODE_TOKENS roles) — so it is
    // real evidence the hydrator wires spans onto matched tags, without
    // depending on a second grammar. The second line is there so the
    // putBreak callback (`() => fragment.append('\n')`) actually runs at
    // least once: every other fixture in this file is one line, and real
    // markdown-it output never is.
    const source = '[text](url "title")\nmore text'
    const c = containerWith(block('markdown', source))

    await createCodeHydrator(load).hydrate(c)

    const code = c.querySelector('code')!
    const spans = Array.from(code.querySelectorAll('span'))
    expect(spans.length).toBeGreaterThan(0)
    // Pinning the class names, not just their count: a span built with any
    // other class (or none) would still pass a bare length check, silently
    // breaking the link between syntaxTags.ts and what actually renders.
    expect(spans.map((s) => s.className)).toEqual(
      expect.arrayContaining(['tok-string', 'tok-link']),
    )
    // The text must survive exactly — highlighting is presentation only.
    expect(code.textContent).toBe(source)
  })

  it('keeps the source-line anchor on the code element', async () => {
    // Only the children are replaced. Scroll sync reads every
    // [data-source-line]; losing or duplicating one desynchronises the pane.
    const c = containerWith(block('markdown', '# Heading'))
    await createCodeHydrator(async () => markdownParser).hydrate(c)

    expect(c.querySelectorAll('[data-source-line]').length).toBe(1)
    expect(c.querySelector('code')!.dataset.sourceLine).toBe('1')
  })

  it('leaves a block alone when the language is unknown', async () => {
    const load: LoadGrammar = vi.fn(async () => null)
    const c = containerWith(block('notalang', 'some text'))

    await createCodeHydrator(load).hydrate(c)

    expect(c.querySelector('code')!.querySelectorAll('span').length).toBe(0)
    expect(c.querySelector('code')!.textContent).toBe('some text')
  })

  it('leaves a block alone when the grammar fails to load', async () => {
    const load: LoadGrammar = vi.fn(async () => {
      throw new Error('network')
    })
    const c = containerWith(block('markdown', '# Heading'))

    await expect(createCodeHydrator(load).hydrate(c)).resolves.toBeUndefined()
    expect(c.querySelector('code')!.textContent).toBe('# Heading')
  })

  it('skips a fence with no language', async () => {
    const load: LoadGrammar = vi.fn(async () => markdownParser)
    const c = containerWith('<pre><code>plain</code></pre>')

    await createCodeHydrator(load).hydrate(c)

    expect(load).not.toHaveBeenCalled()
  })

  it('parses identical content once, however many passes', async () => {
    // Preview assigns innerHTML on every debounced keystroke, so without a
    // cache a large document re-parses every block as you type.
    const load = vi.fn(async () => markdownParser)
    const h = createCodeHydrator(load as LoadGrammar)

    await h.hydrate(containerWith(block('markdown', '# Heading')))
    await h.hydrate(containerWith(block('markdown', '# Heading')))

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps serving highlighted content from the cache on a third pass', async () => {
    // el.replaceChildren(cached.cloneNode(true)) — not
    // el.replaceChildren(cached) — because a DocumentFragment's children move
    // rather than copy into whatever adopts them. Reusing the cached fragment
    // itself leaves it empty after the second pass, and the third pass would
    // then hand an empty fragment to a perfectly live block.
    const load = vi.fn(async () => markdownParser)
    const h = createCodeHydrator(load as LoadGrammar)
    const source = '[text](url "title")'

    await h.hydrate(containerWith(block('markdown', source)))
    await h.hydrate(containerWith(block('markdown', source)))
    const third = containerWith(block('markdown', source))
    await h.hydrate(third)

    const code = third.querySelector('code')!
    expect(code.innerHTML).not.toBe('')
    expect(code.textContent).toBe(source)
  })

  it('does not share a cache entry across languages for identical text', async () => {
    // The cache key is language plus text. Dropping the language half would
    // let a fenced block under one language silently wear another's parse.
    const load = vi.fn(async () => markdownParser)
    const h = createCodeHydrator(load as LoadGrammar)
    const source = '[text](url "title")'

    await h.hydrate(containerWith(block('markdown', source)))
    await h.hydrate(containerWith(block('otherlang', source)))

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('evicts a cached block once its source leaves the document', async () => {
    // charts.ts drops cache entries whose spec is no longer live; this
    // hydrator needs the same eviction, or every distinct edit inside a
    // fence retains its own full fragment for the life of the document.
    const load = vi.fn(async () => markdownParser)
    const h = createCodeHydrator(load as LoadGrammar)

    await h.hydrate(containerWith(block('markdown', 'one')))
    await h.hydrate(containerWith(block('markdown', 'two')))
    // 'one' was not live in the second pass, so it must have been evicted —
    // hydrating it again has to load fresh, not serve a retained fragment.
    await h.hydrate(containerWith(block('markdown', 'one')))

    expect(load).toHaveBeenCalledTimes(3)
  })

  it('leaves a block plain when its grammar throws mid-parse, and still highlights the next one', async () => {
    // language-data routes many languages through StreamLanguage wrappers
    // over legacy CodeMirror 5 modes, whose token() can throw on pathological
    // input. That must not reject the whole pass and abandon every block
    // after the bad one.
    const throwingParser = { parse: () => { throw new Error('parse boom') } } as unknown as Parser
    const load: LoadGrammar = vi.fn(async (name) =>
      name === 'bad' ? throwingParser : markdownParser,
    )
    const c = containerWith(
      block('bad', 'boom') + block('markdown', '[text](url "title")'),
    )

    await expect(createCodeHydrator(load).hydrate(c)).resolves.toBeUndefined()

    const codes = c.querySelectorAll('code')
    expect(codes[0].querySelectorAll('span').length).toBe(0)
    expect(codes[0].textContent).toBe('boom')
    expect(codes[1].querySelectorAll('span').length).toBeGreaterThan(0)
  })

  it('abandons a stale pass entirely when a newer one starts mid-await', async () => {
    // The generation guard: a pass whose load() resolves after a newer pass
    // has already started must not touch the DOM at all, including the very
    // block whose load just resolved, and must never even reach later blocks.
    let resolveGate!: (p: Parser) => void
    const gate = new Promise<Parser>((res) => { resolveGate = res })
    const load: LoadGrammar = vi.fn(async (name) =>
      name === 'gate' ? gate : markdownParser,
    )
    const h = createCodeHydrator(load)

    const containerA = containerWith(
      block('gate', 'first-code') + block('other', 'second-code'),
    )
    const hydrateA = h.hydrate(containerA) // suspends inside the loop awaiting `gate`
    const containerB = containerWith(block('gate', '[text](url "title")'))
    const hydrateB = h.hydrate(containerB) // newer generation, also awaits `gate`

    resolveGate(markdownParser)
    await hydrateA
    await hydrateB

    const codesA = containerA.querySelectorAll('code')
    expect(codesA[0].querySelectorAll('span').length).toBe(0)
    expect(codesA[1].querySelectorAll('span').length).toBe(0)
    expect(load).not.toHaveBeenCalledWith('other')
    // The newer pass was unaffected by the older one's abandonment.
    expect(containerB.querySelector('code')!.querySelectorAll('span').length).toBeGreaterThan(0)
  })
})
