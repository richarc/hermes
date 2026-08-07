// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ChartBuilder from './ChartBuilder.svelte'

// Mock the same module path App.svelte imports from: '../bindings/hermes',
// which exports a DocumentService object rather than loose functions.
const { DocumentService } = vi.hoisted(() => ({
  DocumentService: { ImportData: vi.fn() },
}))
vi.mock('../bindings/hermes', () => ({ DocumentService }))
const ImportData = DocumentService.ImportData

function mountBuilder() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(ChartBuilder, {
    target,
    props: { initial: null, oncommit: vi.fn(), oncancel: vi.fn() },
  })
  flushSync()
  return {
    target,
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

/** Types into the paste box the way a user would. */
function paste(target: HTMLElement, text: string) {
  const box = target.querySelector<HTMLTextAreaElement>('textarea')!
  box.value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

beforeEach(() => ImportData.mockReset())

describe('ChartBuilder data step', () => {
  it('reports the shape of a pasted table', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1.5\n5,3.2\n')
    expect(target.textContent).toContain('2 columns')
    expect(target.textContent).toContain('2 rows')
    cleanup()
  })

  it('shows a parse error inline rather than silently doing nothing', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'a,b,c\n1,2,3\n4,5\n')
    expect(target.textContent).toContain('Row 3')
    cleanup()
  })

  it('clears a previous error once the paste is fixed', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'a,b,c\n4,5\n')
    expect(target.textContent).toContain('Row 2')
    paste(target, 'a,b\n1,2\n')
    expect(target.textContent).not.toContain('Row 2')
    cleanup()
  })

  it('loads data through the Go importer when asked', async () => {
    ImportData.mockResolvedValueOnce('x,y\n1,2\n3,4\n')
    const { target, cleanup } = mountBuilder()
    const button = [...target.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Choose file'),
    )!
    button.click()
    await vi.waitFor(() => expect(target.textContent).toContain('2 rows'))
    cleanup()
  })

  it('reports an import failure without closing the modal', async () => {
    ImportData.mockRejectedValueOnce(new Error('nope'))
    const { target, cleanup } = mountBuilder()
    const button = [...target.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Choose file'),
    )!
    button.click()
    await vi.waitFor(() => expect(target.textContent).toContain("Couldn't read"))
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    cleanup()
  })

  it('warns above the inline-data threshold but still accepts the table', () => {
    const rows = Array.from({ length: 5001 }, (_, i) => `${i},${i}`).join('\n')
    const { target, cleanup } = mountBuilder()
    paste(target, `a,b\n${rows}\n`)
    expect(target.textContent).toContain('5001 rows')
    expect(target.textContent?.toLowerCase()).toContain('large')
    cleanup()
  })

  it('calls oncancel when Cancel is pressed', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const oncancel = vi.fn()
    const cmp = mount(ChartBuilder, {
      target,
      props: { initial: null, oncommit: vi.fn(), oncancel },
    })
    flushSync()
    const button = [...target.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!
    button.click()
    flushSync()
    expect(oncancel).toHaveBeenCalled()
    unmount(cmp)
    target.remove()
  })
})
