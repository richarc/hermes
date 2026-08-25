// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync, type ComponentProps } from 'svelte'
import Preview from './Preview.svelte'
import type { Anchor } from './lib/scrollSync'

vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: vi.fn() } }))

const ANCHORS: Anchor[] = [
  { line: 10, top: 500 },
  { line: 20, top: 1500 },
]

interface PreviewApi {
  syncToLine(line: number, docLines: number): void
}

// A minimal stand-in for @testing-library/svelte's render(), which this
// project does not depend on: mount into a body-attached target, flush, and
// hand back the target as `container` — the one piece of its API the tests
// below need.
function render(Component: typeof Preview, options: { props: ComponentProps<typeof Preview> }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const cmp = mount(Component, { target: container, props: options.props })
  flushSync()
  return { container, cleanup: () => unmount(cmp as never) }
}

function mountPreview(html: string, anchors: Anchor[] = ANCHORS) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(Preview, {
    target,
    props: { html, collectAnchorsFn: () => anchors },
  }) as unknown as PreviewApi
  flushSync()
  const pane = target.querySelector('.preview-pane') as HTMLElement
  // jsdom reports scrollHeight as 0, so stub the one measurement the mapper
  // needs. scrollTop itself is stored and returned faithfully by jsdom.
  Object.defineProperty(pane, 'scrollHeight', { value: 4000, configurable: true })
  return { target, pane, preview: cmp, cleanup: () => unmount(cmp as never) }
}

describe('Preview.syncToLine', () => {
  it('scrolls to the interpolated offset for a line', () => {
    const { pane, preview, cleanup } = mountPreview('<p data-source-line="10">x</p>')
    preview.syncToLine(15, 40)
    expect(pane.scrollTop).toBe(1000)
    cleanup()
  })

  it('lands exactly on an anchor when the line matches one', () => {
    const { pane, preview, cleanup } = mountPreview('<p data-source-line="10">x</p>')
    preview.syncToLine(20, 40)
    expect(pane.scrollTop).toBe(1500)
    cleanup()
  })

  it('does not scroll when the document has no anchors', () => {
    const { pane, preview, cleanup } = mountPreview('<p>x</p>', [])
    preview.syncToLine(15, 40)
    expect(pane.scrollTop).toBe(0)
    cleanup()
  })
})

describe('Preview figure alignment', () => {
  it('publishes the alignment on the pane, in CSS spelling', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(Preview, {
      target,
      props: { html: '<p>x</p>', figureAlign: 'centre', collectAnchorsFn: () => [] },
    })
    flushSync()
    const pane = target.querySelector('.preview-pane') as HTMLElement
    // `centre` is Hermes' spelling; the stylesheet can only match `center`.
    expect(pane.dataset.figureAlign).toBe('center')
    unmount(cmp)
    target.remove()
  })

  it('defaults to centre when no alignment is supplied', () => {
    const { pane, cleanup } = mountPreview('<p>x</p>')
    expect(pane.dataset.figureAlign).toBe('center')
    cleanup()
  })

  it('renders the markdown into a sheet inside the scrolling pane', () => {
    const { container } = render(Preview, { props: { html: '<p>hello</p>' } })
    const pane = container.querySelector('.preview-pane')!
    const sheet = pane.querySelector('.sheet')!
    expect(sheet).not.toBeNull()
    expect(sheet.innerHTML).toBe('<p>hello</p>')
    // The pane is the scroller and must stay empty of document content of its
    // own, so scroll offsets keep meaning what scrollSync assumes.
    expect(pane.firstElementChild).toBe(sheet)
  })

  it('sizes the sheet from the paper and orientation', () => {
    const { container } = render(Preview, {
      props: { html: '', paperSize: 'a4', orientation: 'portrait' },
    })
    const sheet = container.querySelector('.sheet') as HTMLElement
    expect(sheet.style.getPropertyValue('--sheet-width')).toBe('210mm')
    expect(sheet.style.getPropertyValue('--sheet-margin')).toBe('11.905%')
    // The absolute cap travels with the percentage: percentage padding
    // resolves against the PANE, so on a pane wider than the paper the
    // percentage alone drew margins that grew with the window. See paper.ts.
    expect(sheet.style.getPropertyValue('--sheet-margin-max')).toBe('25mm')
  })

  it('resizes the sheet for landscape', () => {
    const { container } = render(Preview, {
      props: { html: '', paperSize: 'a4', orientation: 'landscape' },
    })
    const sheet = container.querySelector('.sheet') as HTMLElement
    expect(sheet.style.getPropertyValue('--sheet-width')).toBe('297mm')
    // Not the portrait percentage: a fixed one would print 25mm and draw 35mm.
    expect(sheet.style.getPropertyValue('--sheet-margin')).toBe('8.418%')
    // The cap does not vary with paper or orientation — it is the page
    // margin itself, which is one number for all four combinations.
    expect(sheet.style.getPropertyValue('--sheet-margin-max')).toBe('25mm')
  })

  it('keeps the alignment attribute on the pane, not the sheet', () => {
    // style.css matches .preview-pane[data-figure-align="…"] .sheet figure.
    // Moving the attribute would silently stop all three alignments working.
    const { container } = render(Preview, { props: { html: '', figureAlign: 'centre' } })
    expect(container.querySelector('.preview-pane')!.getAttribute('data-figure-align')).toBe('center')
    expect(container.querySelector('.sheet')!.hasAttribute('data-figure-align')).toBe(false)
  })
})
