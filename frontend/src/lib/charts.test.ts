// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createChartHydrator, embedChart, type EmbedFn, type ChartView } from './charts'

vi.mock('vega-embed', () => ({
  default: vi.fn(async (el: HTMLElement) => {
    el.appendChild(document.createElement('svg'))
    return { view: { finalize: vi.fn() } }
  }),
}))

function containerWith(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

const SPEC = '{"mark": "bar"}'
const SPEC2 = '{"mark": "line"}'
const placeholder = (spec: string) =>
  `<div class="vega-lite-chart" data-spec="${spec.replace(/"/g, '&quot;')}"></div>`

/** Fake embed that marks the element and returns a trackable view. */
function fakeEmbed() {
  const views: ChartView[] = []
  const fn = vi.fn(async (el: HTMLElement) => {
    el.textContent = 'RENDERED'
    const view: ChartView = { finalize: vi.fn() }
    views.push(view)
    return view
  })
  return { fn: fn as unknown as EmbedFn, calls: fn, views }
}

describe('createChartHydrator: caching', () => {
  it('embeds every placeholder and reuses the cached node on an unchanged spec', async () => {
    const embed = fakeEmbed()
    const h = createChartHydrator(embed.fn)

    const first = containerWith(placeholder(SPEC))
    await h.hydrate(first)
    expect(embed.calls).toHaveBeenCalledTimes(1)

    const second = containerWith(placeholder(SPEC))
    await h.hydrate(second)
    expect(embed.calls).toHaveBeenCalledTimes(1) // reused, not re-embedded
    expect(second.textContent).toContain('RENDERED')
  })

  it('renders both copies of a duplicate spec, reusing only the first on later passes', async () => {
    const embed = fakeEmbed()
    const h = createChartHydrator(embed.fn)

    const first = containerWith(placeholder(SPEC) + placeholder(SPEC))
    await h.hydrate(first)
    expect(embed.calls).toHaveBeenCalledTimes(2)
    expect(first.children.length).toBe(2)

    const second = containerWith(placeholder(SPEC) + placeholder(SPEC))
    await h.hydrate(second)
    // first occurrence moved from cache (no call), extra occurrence embedded fresh
    expect(embed.calls).toHaveBeenCalledTimes(3)
    expect(second.children.length).toBe(2)
    expect(
      Array.from(second.children).every((c) => (c as HTMLElement).textContent === 'RENDERED'),
    ).toBe(true)
  })

  it('drops a stale anchor when the adopted node lands inside a figure', () => {
    // Stripping the title makes a captioned chart's data-spec identical to
    // the same chart uncaptioned, so the cache can hand a node embedded as a
    // bare placeholder (anchor on the div) to a placeholder inside a
    // <figure> (anchor on the figure). Left on, that is two anchors for one
    // source line.
    return (async () => {
      const embed = fakeEmbed()
      const h = createChartHydrator(embed.fn)
      const specAttr = SPEC.replace(/"/g, '&quot;')

      const first = containerWith(
        `<div class="vega-lite-chart" data-source-line="4" data-spec="${specAttr}"></div>`,
      )
      await h.hydrate(first)

      const second = containerWith(
        `<figure data-source-line="4"><div class="vega-lite-chart" data-spec="${specAttr}"></div></figure>`,
      )
      await h.hydrate(second)

      expect(second.querySelectorAll('[data-source-line]')).toHaveLength(1)
      expect(
        second.querySelector<HTMLElement>('.vega-lite-chart')!.dataset.sourceLine,
      ).toBeUndefined()
    })()
  })
})

describe('createChartHydrator: view lifecycle', () => {
  it('finalizes the view of an evicted cache entry', async () => {
    const embed = fakeEmbed()
    const h = createChartHydrator(embed.fn)

    await h.hydrate(containerWith(placeholder(SPEC)))
    await h.hydrate(containerWith(placeholder(SPEC2)))

    expect(embed.views[0].finalize).toHaveBeenCalledTimes(1) // SPEC evicted
    expect(embed.views[1].finalize).not.toHaveBeenCalled() // SPEC2 live
  })

  it('finalizes the extra duplicate view when the next pass replaces it', async () => {
    const embed = fakeEmbed()
    const h = createChartHydrator(embed.fn)

    await h.hydrate(containerWith(placeholder(SPEC) + placeholder(SPEC)))
    // next pass has only one copy: the previous extra (ephemeral) node is gone
    await h.hydrate(containerWith(placeholder(SPEC)))

    const finalizedCount = embed.views.filter(
      (v) => (v.finalize as ReturnType<typeof vi.fn>).mock.calls.length > 0,
    ).length
    expect(finalizedCount).toBe(1)
  })

  it('destroy() finalizes every live view and empties the cache', async () => {
    const embed = fakeEmbed()
    const h = createChartHydrator(embed.fn)

    await h.hydrate(containerWith(placeholder(SPEC) + placeholder(SPEC2)))
    h.destroy()

    for (const view of embed.views) {
      expect(view.finalize).toHaveBeenCalledTimes(1)
    }

    // hydrating again after destroy embeds from scratch
    await h.hydrate(containerWith(placeholder(SPEC)))
    expect(embed.calls).toHaveBeenCalledTimes(3)
  })
})

describe('createChartHydrator: overlapping passes', () => {
  it('a stale pass abandons its work and finalizes its orphaned view', async () => {
    let release: (() => void) | undefined
    const views: ChartView[] = []
    const embed = vi.fn(async (el: HTMLElement) => {
      const view: ChartView = { finalize: vi.fn() }
      views.push(view)
      if (views.length === 1) {
        // hold the FIRST embed open until told to finish
        await new Promise<void>((resolve) => (release = resolve))
      }
      el.textContent = 'RENDERED'
      return view
    })
    const h = createChartHydrator(embed as unknown as EmbedFn)

    const stale = h.hydrate(containerWith(placeholder(SPEC)))
    const fresh = h.hydrate(containerWith(placeholder(SPEC2)))
    await fresh
    release!()
    await stale

    // the stale pass's orphaned view was finalized; the fresh pass's was not
    expect(views[0].finalize).toHaveBeenCalledTimes(1)
    expect(views[1].finalize).not.toHaveBeenCalled()

    // the stale pass must not have cached SPEC: rendering it again re-embeds
    const again = containerWith(placeholder(SPEC))
    await h.hydrate(again)
    expect(again.textContent).toContain('RENDERED')
    expect(embed).toHaveBeenCalledTimes(3)
  })
})

describe('cached charts keep their source line fresh', () => {
  it('adopts the new placeholder line when a cached node is reused', async () => {
    const embed = fakeEmbed()
    const h = createChartHydrator(embed.fn)
    const specAttr = SPEC.replace(/"/g, '&quot;')

    const first = containerWith(
      `<div class="vega-lite-chart" data-source-line="5" data-spec="${specAttr}"></div>`,
    )
    await h.hydrate(first)

    // The user inserted text above the chart: same spec, later line.
    const second = containerWith(
      `<div class="vega-lite-chart" data-source-line="30" data-spec="${specAttr}"></div>`,
    )
    await h.hydrate(second)

    const chart = second.querySelector<HTMLElement>('.vega-lite-chart')
    expect(chart).not.toBeNull()
    expect(chart!.dataset.sourceLine).toBe('30')
  })
})

describe('embedChart', () => {
  it('renders an error card and returns null for invalid JSON', async () => {
    const el = document.createElement('div')
    const view = await embedChart(el, 'not json')
    expect(view).toBeNull()
    expect(el.classList.contains('chart-error')).toBe(true)
    expect(el.textContent).toContain('Chart error:')
  })

  it('embeds valid specs via vega-embed and returns the view', async () => {
    const el = document.createElement('div')
    const view = await embedChart(el, SPEC)
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.classList.contains('chart-error')).toBe(false)
    expect(view).not.toBeNull()
    expect(typeof view!.finalize).toBe('function')
  })
})
