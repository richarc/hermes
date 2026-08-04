// Type-only, so importing it costs nothing at runtime: vega and vega-lite are
// the largest thing Hermes bundles, and a document with no charts should never
// load them. embedChart imports the real module on first use.
import type vegaEmbedFn from 'vega-embed'

/** The slice of a Vega view the hydrator needs for cleanup. */
export interface ChartView {
  finalize(): void
}

export type EmbedFn = (el: HTMLElement, specText: string) => Promise<ChartView | null>

export interface ChartHydrator {
  hydrate(container: HTMLElement): Promise<void>
  destroy(): void
}

/**
 * Creates a hydrator that turns `.vega-lite-chart` placeholders into live
 * charts. It owns the chart lifecycle:
 * - caches the first rendered node per spec text and moves it (no re-embed)
 *   into the new DOM on later passes; extra occurrences of a duplicated spec
 *   are embedded fresh each pass;
 * - finalizes Vega views when their chart leaves the document (cache
 *   eviction, replaced duplicates, or `destroy()`), releasing listeners and
 *   timers;
 * - guards against overlapping passes: when a newer `hydrate` starts, the
 *   older pass abandons its remaining work.
 */
export function createChartHydrator(embed: EmbedFn = embedChart): ChartHydrator {
  const cache = new Map<string, HTMLElement>()
  const views = new Map<HTMLElement, ChartView>()
  let generation = 0

  function finalizeElement(el: HTMLElement): void {
    views.get(el)?.finalize()
    views.delete(el)
  }

  return {
    async hydrate(container: HTMLElement): Promise<void> {
      const gen = ++generation
      const placeholders = Array.from(
        container.querySelectorAll<HTMLElement>('.vega-lite-chart'),
      )
      const liveSpecs = new Set<string>()
      // Every node placed into the new DOM this pass — moved from cache or
      // freshly embedded. A cached node already in this set means the spec is
      // duplicated, so the extra occurrence embeds fresh instead of stealing.
      const placedThisPass = new Set<HTMLElement>()

      for (const el of placeholders) {
        const specText = el.dataset.spec ?? ''
        liveSpecs.add(specText)
        const cached = cache.get(specText)

        if (cached && !placedThisPass.has(cached)) {
          el.replaceWith(cached)
          placedThisPass.add(cached)
          continue
        }

        // No cache entry, or the cached node is already placed this pass
        // (duplicated spec): embed fresh.
        const view = await embed(el, specText)
        if (gen !== generation) {
          // A newer pass started while we awaited: this element belongs to a
          // stale DOM. Release its view and abandon the pass.
          view?.finalize()
          return
        }
        if (view) views.set(el, view)
        placedThisPass.add(el)
        if (!cache.has(specText)) cache.set(specText, el)
      }

      // Evict cache entries whose spec left the document.
      for (const [spec, el] of cache) {
        if (!liveSpecs.has(spec)) {
          cache.delete(spec)
          finalizeElement(el)
        }
      }

      // Finalize tracked views whose element was neither reused nor embedded
      // this pass (e.g. last pass's extra duplicate, or a stale pass's
      // leftovers) — they were discarded with the old DOM.
      for (const el of Array.from(views.keys())) {
        if (!placedThisPass.has(el)) {
          finalizeElement(el)
        }
      }
    },

    destroy(): void {
      for (const el of Array.from(views.keys())) {
        finalizeElement(el)
      }
      cache.clear()
    },
  }
}

export async function embedChart(
  el: HTMLElement,
  specText: string,
): Promise<ChartView | null> {
  let spec: unknown
  try {
    spec = JSON.parse(specText)
  } catch (err) {
    renderChartError(el, `Invalid JSON: ${(err as Error).message}`)
    return null
  }
  try {
    // Inside the try: a chart that cannot load its renderer reports the same
    // way as a chart that cannot render.
    const { default: vegaEmbed } = await import('vega-embed')
    const result = await vegaEmbed(el, spec as Parameters<typeof vegaEmbedFn>[1], {
      actions: false,
    })
    return result.view
  } catch (err) {
    renderChartError(el, (err as Error).message)
    return null
  }
}

function renderChartError(el: HTMLElement, message: string): void {
  el.classList.add('chart-error')
  el.textContent = `Chart error: ${message}`
}
