// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createMermaidHydrator, type RenderFn } from './mermaid'

/** A container holding one placeholder per source given. */
function container(...sources: string[]): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = sources
    .map((s) => `<div class="mermaid-diagram" data-source="${s}"></div>`)
    .join('')
  return el
}

const svgFor: RenderFn = async (id, source) => `<svg id="${id}">${source}</svg>`

describe('createMermaidHydrator', () => {
  it('does not touch a diagram it already rendered when hydrated again in place', async () => {
    const render = vi.fn(svgFor)
    const h = createMermaidHydrator(render)
    const el = container('flowchart LR')
    await h.hydrate(el)
    const svg = el.querySelector('svg')
    expect((el.firstElementChild as HTMLElement).dataset.hydrated).toBeDefined()

    await h.hydrate(el)
    expect(render).toHaveBeenCalledTimes(1)
    expect(el.querySelector('svg')).toBe(svg) // same node, not a re-parsed copy
  })

  it('replaces a placeholder with the rendered SVG', async () => {
    const el = container('flowchart LR')
    await createMermaidHydrator(svgFor).hydrate(el)

    expect(el.querySelector('.mermaid-diagram svg')).not.toBeNull()
    expect(el.textContent).toContain('flowchart LR')
  })

  // Two identical diagrams must not cost two renders. They share the rendered
  // markup, id included — harmless because the injected styles are identical.
  it('renders one source once however many times it appears', async () => {
    const render = vi.fn(svgFor)
    await createMermaidHydrator(render).hydrate(container('same', 'same'))

    expect(render).toHaveBeenCalledTimes(1)
  })

  it('renders each distinct source', async () => {
    const render = vi.fn(svgFor)
    await createMermaidHydrator(render).hydrate(container('one', 'two'))

    expect(render).toHaveBeenCalledTimes(2)
  })

  it('gives each render a distinct id, since Mermaid scopes its styles to one', async () => {
    const ids: string[] = []
    const render: RenderFn = async (id) => {
      ids.push(id)
      return `<svg id="${id}"></svg>`
    }
    await createMermaidHydrator(render).hydrate(container('one', 'two'))

    expect(new Set(ids).size).toBe(2)
  })

  it('shows an error card when a diagram will not render', async () => {
    const render: RenderFn = async () => {
      throw new Error('No diagram type detected')
    }
    const el = container('not a diagram')
    await createMermaidHydrator(render).hydrate(el)

    const card = el.querySelector('.mermaid-error')
    expect(card).not.toBeNull()
    expect(card!.textContent).toBe('Diagram error: No diagram type detected')
  })

  it('renders the diagrams either side of a failing one', async () => {
    const render: RenderFn = async (id, source) => {
      if (source === 'bad') throw new Error('nope')
      return `<svg id="${id}">${source}</svg>`
    }
    const el = container('good one', 'bad', 'good two')
    await createMermaidHydrator(render).hydrate(el)

    expect(el.querySelectorAll('svg')).toHaveLength(2)
    expect(el.querySelectorAll('.mermaid-error')).toHaveLength(1)
  })

  it('forgets a source that left the document, so re-adding it renders again', async () => {
    const render = vi.fn(svgFor)
    const hydrator = createMermaidHydrator(render)
    await hydrator.hydrate(container('gone'))
    await hydrator.hydrate(container('other'))
    await hydrator.hydrate(container('gone'))

    expect(render).toHaveBeenCalledTimes(3)
  })

  it('keeps serving a source that stayed, without re-rendering it', async () => {
    const render = vi.fn(svgFor)
    const hydrator = createMermaidHydrator(render)
    await hydrator.hydrate(container('stays'))
    await hydrator.hydrate(container('stays'))

    expect(render).toHaveBeenCalledTimes(1)
  })

  // Preview re-renders on every debounced keystroke, so passes overlap. An
  // older pass finishing late must not write into a DOM a newer pass owns.
  it('abandons a pass once a newer one has started', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const render: RenderFn = async (id, source) => {
      if (source === 'slow') await gate
      return `<svg id="${id}">${source}</svg>`
    }
    const hydrator = createMermaidHydrator(render)
    const stale = container('slow')

    const first = hydrator.hydrate(stale)
    await hydrator.hydrate(container('fresh'))
    release!()
    await first

    // The stale container was never written to: its placeholder is still empty.
    expect(stale.querySelector('svg')).toBeNull()
  })
})
