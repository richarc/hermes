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
  // The preview keeps an unchanged block's node, but a block that did change
  // — or the same code moved into a new block — arrives as a fresh node, and
  // without this a large document would re-parse every one of those.
  const cache = new Map<string, DocumentFragment>()
  let generation = 0

  return {
    async hydrate(container: HTMLElement): Promise<void> {
      const gen = ++generation
      const blocks = Array.from(
        container.querySelectorAll<HTMLElement>('pre > code[class*="language-"]'),
      )
      // Every key this pass actually saw, live or cached. Anything left out
      // of the cache after the loop belonged to a block no longer in the
      // document — same eviction pattern as createChartHydrator's specs, so
      // editing inside a fence does not retain a fragment per keystroke.
      const liveKeys = new Set<string>()

      for (const el of blocks) {
        const lang = /(?:^|\s)language-(\S+)/.exec(el.className)?.[1]
        if (!lang) continue
        const code = el.textContent ?? ''
        const key = `${lang}\n${code}`
        liveKeys.add(key)

        // Already highlighted and kept in place by the preview's
        // reconciliation. The spans preserve textContent, so the key above
        // still holds the cache entry live.
        if (el.dataset.hydrated !== undefined) continue

        const cached = cache.get(key)
        if (cached) {
          el.replaceChildren(cached.cloneNode(true))
          el.dataset.hydrated = ''
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

        let fragment: DocumentFragment
        try {
          fragment = document.createDocumentFragment()
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
        } catch {
          // A grammar that throws mid-parse (StreamLanguage wrappers over
          // legacy modes can, on pathological input) must not reject the
          // whole pass and abandon every block after this one — it degrades
          // to plain text exactly like an unavailable grammar does.
          continue
        }
        cache.set(key, fragment)
        el.replaceChildren(fragment.cloneNode(true))
        el.dataset.hydrated = ''
      }

      for (const k of cache.keys()) {
        if (!liveKeys.has(k)) cache.delete(k)
      }
    },
  }
}
