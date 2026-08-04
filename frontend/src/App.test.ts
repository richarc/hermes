// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

const { DocumentService, listeners, recents } = vi.hoisted(() => {
  const listeners: Record<string, (ev: { data: unknown }) => void> = {}
  const recents = { current: [] as string[] }
  return {
    listeners,
    recents,
    DocumentService: {
      RecentFiles: vi.fn(async () => recents.current),
      SetDirty: vi.fn(async () => {}),
      WatchBibliography: vi.fn(async () => {}),
      ReadBibliography: vi.fn(async () => ''),
      Open: vi.fn(async () => ({ path: '', content: '' })),
      OpenPath: vi.fn(async () => ({ path: '', content: '' })),
      Save: vi.fn(async () => {}),
      SaveAs: vi.fn(async () => ''),
      Quit: vi.fn(async () => {}),
      PickCitations: vi.fn(async () => ''),
      ExportPDF: vi.fn(async () => {}),
    },
  }
})

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: (name: string, cb: (ev: { data: unknown }) => void) => {
      listeners[name] = cb
    },
  },
  Browser: { OpenURL: vi.fn() },
}))
vi.mock('../bindings/hermes', () => ({ DocumentService }))

import App from './App.svelte'

function mountApp() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(App, { target })
  flushSync() // Svelte 5 runs onMount in a microtask
  return { target, cleanup: () => unmount(cmp) }
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
}

beforeEach(() => {
  recents.current = []
  vi.clearAllMocks()
})

describe('welcome pane', () => {
  it('offers both New document and Open… when recents exist', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    expect(buttonByText(target, 'New document')).toBeDefined()
    expect(buttonByText(target, 'Open…')).toBeDefined()

    cleanup()
  })

  it('routes Open… through the same file dialog as the toolbar', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'Open…')).toBeDefined())

    buttonByText(target, 'Open…')!.click()
    flushSync()

    expect(DocumentService.Open).toHaveBeenCalled()
    cleanup()
  })
})

describe('new documents', () => {
  const templated = (target: HTMLElement) =>
    target.querySelector('.editor-pane')?.textContent ?? ''

  it('seeds the template and is not dirty', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()

    expect(templated(target)).toContain('bibliography: references.bib')
    // The status bar appends " •" only while dirty. A template the user never
    // touched must not prompt on close.
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')

    cleanup()
  })

  it('produces the same document from File → New as from the button', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:new']({ data: null })
    flushSync()

    expect(templated(target)).toContain('bibliography: references.bib')
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')

    cleanup()
  })

  it('dismisses the welcome pane', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()

    expect(target.querySelector('.welcome')).toBeNull()
    cleanup()
  })
})
