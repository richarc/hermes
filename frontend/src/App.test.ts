// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

const { DocumentService, listeners, recents, settings } = vi.hoisted(() => {
  const listeners: Record<string, (ev: { data: unknown }) => void> = {}
  const recents = { current: [] as string[] }
  const settings = {
    current: { printOrientation: 'portrait', syncScrolling: false, theme: 'system' },
  }
  return {
    listeners,
    recents,
    settings,
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
      Settings: vi.fn(async () => settings.current),
      UpdateSettings: vi.fn(async () => {}),
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

// Tracked so afterEach can always unmount, even when a test body throws
// partway through — otherwise a failing assertion leaves App mounted with a
// live $effect still calling DocumentService.SetDirty, which pollutes later
// tests' mock call counts and turns one real failure into a cascade.
let mounted: ReturnType<typeof mount> | undefined

function mountApp() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(App, { target })
  mounted = cmp
  flushSync() // Svelte 5 runs onMount in a microtask
  return { target }
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
}

// jsdom does not implement matchMedia at all (not a stub — simply absent), and
// App's onMount calls it unconditionally. Install a default fake before every
// test so mounts outside the theme suite don't crash; theme tests overwrite
// it with their own value before mounting.
function stubMatchMedia(prefersDark: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = []
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches: prefersDark,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
        listeners.push(cb),
      removeEventListener: () => {},
    }),
  })
  return { fire: (matches: boolean) => listeners.forEach((cb) => cb({ matches })) }
}

beforeEach(() => {
  recents.current = []
  vi.clearAllMocks()
  stubMatchMedia(false)
  // applyTheme writes to <html>'s dataset, which outlives unmount (afterEach
  // only clears document.body). Left in place, a stale value from a prior
  // test can make a later assertion pass for the wrong reason.
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  if (mounted) {
    unmount(mounted)
    mounted = undefined
  }
  document.body.innerHTML = ''
})

describe('welcome pane', () => {
  it('offers both New document and Open… when recents exist', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    expect(buttonByText(target, 'New document')).toBeDefined()
    expect(buttonByText(target, 'Open…')).toBeDefined()
  })

  it('routes Open… through the same file dialog as the toolbar', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'Open…')).toBeDefined())

    buttonByText(target, 'Open…')!.click()
    flushSync()

    expect(DocumentService.Open).toHaveBeenCalled()
  })
})

describe('new documents', () => {
  const templated = (target: HTMLElement) =>
    target.querySelector('.editor-pane')?.textContent ?? ''

  it('seeds the template and is not dirty', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()

    expect(templated(target)).toContain('bibliography: references.bib')
    // The status bar appends " •" only while dirty. A template the user never
    // touched must not prompt on close.
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')
  })

  it('templates the document from File → New', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:new']({ data: null })
    flushSync()

    expect(templated(target)).toContain('bibliography: references.bib')
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')
  })

  it('dismisses the welcome pane', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()

    expect(target.querySelector('.welcome')).toBeNull()
  })
})

describe('first launch', () => {
  it('templates the document when there are no recents', async () => {
    recents.current = []
    const { target } = mountApp()

    await vi.waitFor(() => {
      expect(target.querySelector('.editor-pane')?.textContent).toContain(
        'bibliography: references.bib',
      )
    })
    expect(target.querySelector('.welcome')).toBeNull()
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')
  })

  it('shows the welcome pane and leaves the document empty when recents exist', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    expect(target.querySelector('.editor-pane')?.textContent).not.toContain('bibliography')
  })

  it('still templates the document when Settings() rejects', async () => {
    recents.current = []
    DocumentService.Settings.mockRejectedValueOnce(new Error('boom'))
    const { target } = mountApp()

    await vi.waitFor(() => {
      expect(target.querySelector('.editor-pane')?.textContent).toContain(
        'bibliography: references.bib',
      )
    })
    expect(target.querySelector('.welcome')).toBeNull()
  })
})

describe('scroll sync', () => {
  it('does not move the preview while sync is off', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'system' }
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.cm-scroller')).not.toBeNull())

    const pane = target.querySelector('.preview-pane') as HTMLElement
    Object.defineProperty(pane, 'scrollHeight', { value: 4000, configurable: true })
    const scroller = target.querySelector('.cm-scroller') as HTMLElement
    scroller.dispatchEvent(new Event('scroll'))
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(pane.scrollTop).toBe(0)
  })

  it('reads the persisted setting at startup', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: true, theme: 'system' }
    recents.current = []
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
  })

  it('re-reads the setting when the menu changes it', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'system' }
    recents.current = []
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())

    const before = DocumentService.Settings.mock.calls.length
    settings.current = { printOrientation: 'portrait', syncScrolling: true, theme: 'system' }
    listeners['settings:changed']({ data: null })
    await vi.waitFor(() =>
      expect(DocumentService.Settings.mock.calls.length).toBeGreaterThan(before),
    )
  })
})

describe('theme', () => {
  it('applies the persisted explicit theme', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'dark' }
    recents.current = []
    stubMatchMedia(false)
    mountApp()

    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
  })

  it('follows the system preference when the setting is system', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'system' }
    recents.current = []
    stubMatchMedia(true)
    mountApp()

    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
  })

  it('ignores the system preference when the setting is explicit', async () => {
    // The case most likely to regress: a system change must not override an
    // explicit choice.
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'light' }
    recents.current = []
    const media = stubMatchMedia(false)
    mountApp()
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('light'),
    )

    media.fire(true)
    flushSync()

    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('flips the theme when the system preference changes and the setting is system', async () => {
    // Positive counterpart to the "ignores" test above: proves the change
    // listener is actually wired, not merely that firing it does nothing.
    // Without this, deleting the addEventListener call in App.svelte would
    // leave both tests passing for the wrong reason.
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'system' }
    recents.current = []
    const media = stubMatchMedia(false)
    mountApp()
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('light'),
    )

    media.fire(true)
    flushSync()

    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('fold menu', () => {
  const WITH_CODE = '# Results\n\n```js\nconst x = 1\nconst y = 2\n```\n'

  async function mountWithCodeBlock() {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({
      path: '/tmp/paper.md',
      content: WITH_CODE,
    })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('const x'))
    return target
  }

  it('folds every code block when the menu asks', async () => {
    const target = await mountWithCodeBlock()

    listeners['menu:fold']({ data: 'fold-all-code' })
    flushSync()

    // The placeholder pill is what replaces the hidden lines.
    await vi.waitFor(() =>
      expect(target.querySelector('.cm-foldPlaceholder')).not.toBeNull(),
    )
  })

  it('ignores an unknown command name', async () => {
    const target = await mountWithCodeBlock()

    // Must not throw — the same tolerance menu:format already has.
    listeners['menu:fold']({ data: 'not-a-command' })
    flushSync()

    expect(target.querySelector('.cm-foldPlaceholder')).toBeNull()
  })
})
