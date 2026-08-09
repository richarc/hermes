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
    // markdown's own highlight config mapping LinkTitle to tags.string, one
    // of the six CODE_TOKENS roles — so it is real evidence the hydrator
    // wires spans onto matched tags, without depending on a second grammar.
    const source = '[text](url "title")'
    const c = containerWith(block('markdown', source))

    await createCodeHydrator(load).hydrate(c)

    const code = c.querySelector('code')!
    expect(code.querySelectorAll('span').length).toBeGreaterThan(0)
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
})
