import { highlightCode } from '@lezer/highlight'
import { languages } from '@codemirror/language-data'
import type { Parser } from '@lezer/common'
import { codeTagHighlighter } from './syntaxTags'

/** Resolves a fence's language name to a parser, or null if unknown. */
export type LoadGrammar = (name: string) => Promise<Parser | null>

export interface CodeHydrator {
  hydrate(container: HTMLElement): Promise<void>
}

/**
 * The default resolver: the editor's own grammars, looked up by name or alias
 * and imported on demand. A paper with one Python block loads one grammar; a
 * paper with none loads nothing — the same laziness charts.ts applies to
 * vega-embed, for the same reason.
 */
export async function loadGrammar(name: string): Promise<Parser | null> {
  const lower = name.toLowerCase()
  const desc = languages.find(
    (l) => l.name.toLowerCase() === lower || l.alias.includes(lower),
  )
  if (!desc) return null
  const support = await desc.load()
  return support.language.parser
}

const HIGHLIGHTER = codeTagHighlighter()

/**
 * Turns `<pre><code class="language-x">` blocks into tagged spans.
 *
 * A hydration pass rather than part of render(): markdown-it's `highlight`
 * option is synchronous and grammars load asynchronously, and render() runs on
 * every debounced keystroke so it has to stay cheap. Modelled on
 * createChartHydrator, including the generation guard.
 *
 * Unlike that one it does not invalidate scroll-sync anchors afterwards —
 * spans do not change a block's height.
 */
export function createCodeHydrator(load: LoadGrammar = loadGrammar): CodeHydrator {
  // Keyed on language and source text, which is all the output depends on.
  // Preview.svelte reassigns innerHTML on every render, so without this a
  // large document re-parses every block on every keystroke.
  const cache = new Map<string, DocumentFragment>()
  let generation = 0

  return {
    async hydrate(container: HTMLElement): Promise<void> {
      const gen = ++generation
      const blocks = Array.from(
        container.querySelectorAll<HTMLElement>('pre > code[class*="language-"]'),
      )

      for (const el of blocks) {
        const lang = /language-([^\s]+)/.exec(el.className)?.[1]
        if (!lang) continue
        const code = el.textContent ?? ''
        const key = `${lang}\n${code}`

        const cached = cache.get(key)
        if (cached) {
          el.replaceChildren(cached.cloneNode(true))
          continue
        }

        let parser: Parser | null = null
        try {
          parser = await load(lang)
        } catch {
          // An unavailable grammar leaves the block exactly as it renders
          // today. Every failure here degrades to plain text on purpose.
          continue
        }
        if (gen !== generation) return // a newer pass owns the DOM now
        if (!parser) continue

        const fragment = document.createDocumentFragment()
        highlightCode(
          code,
          parser.parse(code),
          HIGHLIGHTER,
          (text, classes) => {
            // Real nodes rather than an HTML string: the text is document
            // content, and building nodes sidesteps escaping entirely.
            if (!classes) return void fragment.append(text)
            const span = document.createElement('span')
            span.className = classes
            span.textContent = text
            fragment.append(span)
          },
          () => fragment.append('\n'),
        )
        cache.set(key, fragment)
        el.replaceChildren(fragment.cloneNode(true))
      }
    },
  }
}
