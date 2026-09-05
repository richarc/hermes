/**
 * Mermaid diagrams: the hydrator that turns `.mermaid-diagram` placeholders
 * into real SVG, and the render function it calls.
 *
 * Simpler than createChartHydrator on purpose. That one tracks Vega `view`
 * objects and finalizes them, because a live view holds listeners and timers;
 * a Mermaid render returns a static SVG string and there is nothing to leak.
 * So this follows createCodeHydrator instead: a cache keyed on source text, a
 * generation guard, and eviction of sources that left the document.
 */

/** Renders diagram source to SVG markup. `id` scopes Mermaid's own styles. */
export type RenderFn = (id: string, source: string) => Promise<string>

export interface MermaidHydrator {
  hydrate(container: HTMLElement): Promise<void>
}

/**
 * Creates a hydrator for `.mermaid-diagram` placeholders.
 *
 * `render` is injectable for the reason createChartHydrator takes `embed`:
 * Mermaid appends temporary nodes to document.body mid-render and needs real
 * layout, neither of which jsdom provides, so no test can call the real one.
 */
export function createMermaidHydrator(render: RenderFn = renderMermaid): MermaidHydrator {
  // Keyed on source text, which is all the output depends on.
  const cache = new Map<string, string>()
  let generation = 0
  let nextId = 0

  return {
    async hydrate(container: HTMLElement): Promise<void> {
      const gen = ++generation
      const placeholders = Array.from(
        container.querySelectorAll<HTMLElement>('.mermaid-diagram'),
      )
      const liveSources = new Set<string>()

      for (const el of placeholders) {
        const source = el.dataset.source ?? ''
        liveSources.add(source)

        // Already rendered and kept in place by the preview's reconciliation:
        // re-setting the same SVG would only re-parse it.
        if (el.dataset.hydrated !== undefined) continue

        const cached = cache.get(source)
        if (cached !== undefined) {
          el.innerHTML = cached
          el.dataset.hydrated = ''
          continue
        }

        let svg: string
        try {
          svg = await render(`hermes-mermaid-${nextId++}`, source)
        } catch (err) {
          // A newer pass owns the DOM now; this element belongs to a stale one.
          if (gen !== generation) return
          renderDiagramError(el, (err as Error).message)
          // The source is what failed, and it is unchanged for as long as
          // the node is kept — no point retrying on every render.
          el.dataset.hydrated = ''
          continue
        }
        if (gen !== generation) return

        cache.set(source, svg)
        el.innerHTML = svg
        el.dataset.hydrated = ''
      }

      // Evict entries whose source left the document — the same eviction
      // createCodeHydrator does, so editing inside a fence does not retain a
      // rendered diagram per keystroke.
      for (const source of cache.keys()) {
        if (!liveSources.has(source)) cache.delete(source)
      }
    },
  }
}

let initialised = false

/**
 * The real renderer: Mermaid, imported on demand.
 *
 * The import is dynamic and must stay that way — Mermaid is among the largest
 * things Hermes could bundle, and a paper with no diagrams should never load
 * it. Same constraint charts.ts documents for vega-embed.
 */
export async function renderMermaid(id: string, source: string): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  if (!initialised) {
    mermaid.initialize({
      startOnLoad: false,
      // Load-bearing, not a preference. Without it a parse failure makes
      // Mermaid render its OWN error diagram into the page rather than
      // throwing — and renderDiagramError below becomes unreachable.
      suppressErrorRendering: true,
    })
    initialised = true
  }
  const { svg } = await mermaid.render(id, source)
  return svg
}

function renderDiagramError(el: HTMLElement, message: string): void {
  el.classList.add('mermaid-error')
  el.textContent = `Diagram error: ${message}`
}
