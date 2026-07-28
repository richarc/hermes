// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { hydrateCharts, embedChart } from './charts'

vi.mock('vega-embed', () => ({
  default: vi.fn(async (el: HTMLElement) => {
    el.appendChild(document.createElement('svg'))
  }),
}))

function containerWith(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

const SPEC = '{"mark": "bar"}'
const placeholder = (spec: string) =>
  `<div class="vega-lite-chart" data-spec="${spec.replace(/"/g, '&quot;')}"></div>`

describe('hydrateCharts', () => {
  it('embeds every placeholder and caches by spec text', async () => {
    const embed = vi.fn(async () => {})
    const cache = new Map<string, HTMLElement>()
    const container = containerWith(placeholder(SPEC))

    await hydrateCharts(container, cache, embed)

    expect(embed).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })

  it('reuses the cached element instead of re-embedding an unchanged spec', async () => {
    const embed = vi.fn(async (el: HTMLElement) => {
      el.textContent = 'RENDERED'
    })
    const cache = new Map<string, HTMLElement>()

    const first = containerWith(placeholder(SPEC))
    await hydrateCharts(first, cache, embed)

    const second = containerWith(placeholder(SPEC))
    await hydrateCharts(second, cache, embed)

    expect(embed).toHaveBeenCalledTimes(1)
    expect(second.textContent).toContain('RENDERED')
  })

  it('evicts cache entries whose spec is no longer in the document', async () => {
    const embed = vi.fn(async () => {})
    const cache = new Map<string, HTMLElement>()

    await hydrateCharts(containerWith(placeholder(SPEC)), cache, embed)
    await hydrateCharts(containerWith(placeholder('{"mark": "line"}')), cache, embed)

    expect(cache.size).toBe(1)
    expect(cache.has('{"mark": "line"}')).toBe(true)
  })
})

describe('embedChart', () => {
  it('renders an error card for invalid JSON', async () => {
    const el = document.createElement('div')
    await embedChart(el, 'not json')
    expect(el.classList.contains('chart-error')).toBe(true)
    expect(el.textContent).toContain('Chart error:')
  })

  it('embeds valid specs via vega-embed', async () => {
    const el = document.createElement('div')
    await embedChart(el, SPEC)
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.classList.contains('chart-error')).toBe(false)
  })
})
