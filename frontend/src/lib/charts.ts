import vegaEmbed from 'vega-embed'

export async function hydrateCharts(
  container: HTMLElement,
  cache: Map<string, HTMLElement>,
  embed: (el: HTMLElement, specText: string) => Promise<void> = embedChart,
): Promise<void> {
  const placeholders = Array.from(
    container.querySelectorAll<HTMLElement>('.vega-lite-chart'),
  )
  const liveSpecs = new Set<string>()
  const usedCachedNodes = new Set<HTMLElement>()
  const newlyEmbedded = new Map<string, HTMLElement>()

  for (const el of placeholders) {
    const specText = el.dataset.spec ?? ''
    liveSpecs.add(specText)
    const cached = cache.get(specText)

    // If cached and already used this pass, embed fresh (not moving/cloning)
    if (cached && usedCachedNodes.has(cached)) {
      await embed(el, specText)
      // Don't cache this duplicate occurrence
      continue
    }

    // If cached and not yet used, move it
    if (cached && !usedCachedNodes.has(cached)) {
      el.replaceWith(cached)
      usedCachedNodes.add(cached)
      continue
    }

    // Embed fresh and track first embed of this spec this pass
    await embed(el, specText)
    if (!newlyEmbedded.has(specText)) {
      newlyEmbedded.set(specText, el)
    }
  }

  // Update cache with newly embedded elements (only first occurrence of each spec)
  for (const [spec, el] of newlyEmbedded) {
    if (!cache.has(spec)) {
      cache.set(spec, el)
    }
  }

  for (const key of cache.keys()) {
    if (!liveSpecs.has(key)) cache.delete(key)
  }
}

export async function embedChart(el: HTMLElement, specText: string): Promise<void> {
  let spec: unknown
  try {
    spec = JSON.parse(specText)
  } catch (err) {
    renderChartError(el, `Invalid JSON: ${(err as Error).message}`)
    return
  }
  try {
    await vegaEmbed(el, spec as Parameters<typeof vegaEmbed>[1], { actions: false })
  } catch (err) {
    renderChartError(el, (err as Error).message)
  }
}

function renderChartError(el: HTMLElement, message: string): void {
  el.classList.add('chart-error')
  el.textContent = `Chart error: ${message}`
}
