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

  for (const el of placeholders) {
    const specText = el.dataset.spec ?? ''
    liveSpecs.add(specText)
    const cached = cache.get(specText)
    if (cached) {
      el.replaceWith(cached)
      continue
    }
    await embed(el, specText)
    cache.set(specText, el)
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
