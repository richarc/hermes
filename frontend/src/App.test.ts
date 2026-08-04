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
