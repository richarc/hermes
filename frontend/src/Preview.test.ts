// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
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
