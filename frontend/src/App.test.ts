// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { EditorView } from '@codemirror/view'

const { DocumentService, listeners, recents, settings, DEFAULT_SETTINGS } = vi.hoisted(() => {
  const listeners: Record<string, (ev: { data: unknown }) => void> = {}
  const recents = { current: [] as string[] }
  const DEFAULT_SETTINGS = {
    printOrientation: 'portrait',
    syncScrolling: false,
    showOutline: false,
    theme: 'system',
    figureAlignment: 'centre',
    chartWidth: 'medium',
  }
  const settings = { current: { ...DEFAULT_SETTINGS } }
  return {
    listeners,
    recents,
    settings,
    DEFAULT_SETTINGS,
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
      UpdateSettings: vi.fn(async (_next: typeof DEFAULT_SETTINGS) => {}),
      ImportData: vi.fn(async () => ''),
      ChooseNewDocumentPath: vi.fn(async () => ''),
      CreateDocument: vi.fn(async (path: string, content: string, _bibName: string, _bibContent: string) => ({ path, content })),
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
  const editorText = (target: HTMLElement) =>
    target.querySelector('.editor-pane')?.textContent ?? ''
  const dialog = (target: HTMLElement) =>
    target.querySelector('dialog[aria-label="New document"]') as HTMLDialogElement | null

  it('opens the New… dialog from the welcome pane and File → New', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()
    expect(dialog(target)?.open).toBe(true)

    buttonByText(target, 'Cancel')!.click()
    flushSync()
    expect(dialog(target)?.open).toBe(false)
    // Cancelling made nothing: the welcome pane is still there.
    expect(target.querySelector('.welcome')).not.toBeNull()

    listeners['menu:new']({ data: null })
    flushSync()
    expect(dialog(target)?.open).toBe(true)
  })

  it('creates the document and its bibliography beside it, then loads it', async () => {
    recents.current = ['/papers/thesis.md']
    DocumentService.ChooseNewDocumentPath.mockResolvedValueOnce('/papers/draft.md')
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()
    buttonByText(target, 'Create…')!.click()

    await vi.waitFor(() => expect(DocumentService.CreateDocument).toHaveBeenCalled())
    const [path, content, bibName, bibContent] = DocumentService.CreateDocument.mock.calls[0]
    expect(path).toBe('/papers/draft.md')
    expect(content).toContain('bibliography: draft.bib')
    expect(content).toContain('csl: apa')
    expect(bibName).toBe('draft.bib')
    expect(bibContent.startsWith('%')).toBe(true)

    await vi.waitFor(() => expect(editorText(target)).toContain('bibliography: draft.bib'))
    expect(target.querySelector('.welcome')).toBeNull()
    // A document that was just written to disk is not dirty.
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')
    expect(target.querySelector('.status-bar')?.textContent).toContain('draft.md')
  })

  it('writes the commented template and no bibliography when unticked', async () => {
    recents.current = ['/papers/thesis.md']
    DocumentService.ChooseNewDocumentPath.mockResolvedValueOnce('/papers/notes.md')
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()
    const box = dialog(target)!.querySelector('input[type="checkbox"]') as HTMLInputElement
    box.click()
    flushSync()
    expect(dialog(target)!.querySelector('select')).toBeNull()
    buttonByText(target, 'Create…')!.click()

    await vi.waitFor(() => expect(DocumentService.CreateDocument).toHaveBeenCalled())
    const [, content, bibName] = DocumentService.CreateDocument.mock.calls[0]
    expect(content).toContain('# bibliography: references.bib')
    expect(bibName).toBe('')
  })

  it('does nothing when the save panel is cancelled', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()
    buttonByText(target, 'Create…')!.click()

    await vi.waitFor(() => expect(DocumentService.ChooseNewDocumentPath).toHaveBeenCalled())
    await Promise.resolve()
    expect(DocumentService.CreateDocument).not.toHaveBeenCalled()
    expect(target.querySelector('.welcome')).not.toBeNull()
  })
})

describe('outline panel', () => {
  it('is hidden by default, with a reveal arrow in its place', async () => {
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.editor-pane')).not.toBeNull())
    expect(target.querySelector('.outline')).toBeNull()
    expect(target.querySelector('.outline-reveal')).not.toBeNull()
  })

  it('shows when the setting is on and lists the document headings', async () => {
    recents.current = []
    settings.current = { ...DEFAULT_SETTINGS, showOutline: true }
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.outline')).not.toBeNull())
    expect(target.querySelector('.outline-empty')?.textContent).toContain('No headings')

    listeners['menu:open-recent'] // ensure listeners registered
    // Load a document with headings through the open-recent path.
    DocumentService.OpenPath.mockResolvedValueOnce({
      path: '/papers/p.md',
      content: '# One\n\n## Two\n',
    })
    listeners['menu:open-recent']({ data: '/papers/p.md' })
    await vi.waitFor(() =>
      expect([...target.querySelectorAll('.outline-entry')].map((b) => b.textContent?.trim())).toEqual([
        'One',
        'Two',
      ]),
    )
  })

  it('retracts through its arrow by writing the setting', async () => {
    recents.current = []
    settings.current = { ...DEFAULT_SETTINGS, showOutline: true }
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.outline')).not.toBeNull())

    ;(target.querySelector('.outline-header .outline-arrow') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(DocumentService.UpdateSettings).toHaveBeenCalled())
    expect(DocumentService.UpdateSettings.mock.calls[0][0].showOutline).toBe(false)
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
    settings.current = { ...DEFAULT_SETTINGS }
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

  // Deferred review finding, v0.5: the scroll-sync frame was requested and
  // never cancelled. Latent for as long as App is the root component and only
  // unmounts when the process is going away anyway — but it is a leak the
  // moment anything else unmounts it, and App already has teardown to hang it
  // off, so there is no reason to leave it pending.
  //
  // Asserting that cancelAnimationFrame was *called* proves nothing:
  // CodeMirror cancels frames of its own on destroy, so that passes against
  // an App that cancels nothing. This does the accounting instead — every
  // frame requested must have run or been cancelled by the time the unmount
  // returns — which fails against the unfixed App and cannot be satisfied by
  // somebody else's teardown.
  it('leaves no scroll-sync frame pending after unmount', async () => {
    settings.current = { ...DEFAULT_SETTINGS, syncScrolling: true }
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
    // Wait for onMount's async startup to have finished seeding the template,
    // not merely for the editor to exist. Unmounting between those two points
    // makes doNew() run against a torn-down component — a different race, and
    // not the one under test.
    await vi.waitFor(() =>
      expect(target.querySelector('.editor-pane')?.textContent).toContain('bibliography'),
    )
    flushSync()

    const pending = new Set<number>()
    const realRequest = window.requestAnimationFrame.bind(window)
    const realCancel = window.cancelAnimationFrame.bind(window)
    const request = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        const id = realRequest((t) => {
          pending.delete(id)
          cb(t)
        })
        pending.add(id)
        return id
      })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      pending.delete(id)
      realCancel(id)
    })

    const scroller = target.querySelector('.cm-scroller') as HTMLElement
    scroller.dispatchEvent(new Event('scroll')) // queues the frame
    expect(pending.size).toBeGreaterThan(0)

    // Unmount before it runs — the case the finding is about.
    unmount(mounted!)
    mounted = undefined

    expect([...pending]).toEqual([])
    request.mockRestore()
    cancel.mockRestore()
  })

  it('reads the persisted setting at startup', async () => {
    settings.current = { ...DEFAULT_SETTINGS, syncScrolling: true }
    recents.current = []
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
  })

  it('re-reads the setting when the menu changes it', async () => {
    settings.current = { ...DEFAULT_SETTINGS }
    recents.current = []
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())

    const before = DocumentService.Settings.mock.calls.length
    settings.current = { ...DEFAULT_SETTINGS, syncScrolling: true }
    listeners['settings:changed']({ data: null })
    await vi.waitFor(() =>
      expect(DocumentService.Settings.mock.calls.length).toBeGreaterThan(before),
    )
  })
})

describe('theme', () => {
  it('applies the persisted explicit theme', async () => {
    settings.current = { ...DEFAULT_SETTINGS, theme: 'dark' }
    recents.current = []
    stubMatchMedia(false)
    mountApp()

    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
  })

  it('follows the system preference when the setting is system', async () => {
    settings.current = { ...DEFAULT_SETTINGS }
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
    settings.current = { ...DEFAULT_SETTINGS, theme: 'light' }
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
    settings.current = { ...DEFAULT_SETTINGS }
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
  const WITH_CODE =
    '# Results\n\nSome prose that explains the numbers.\n\n```js\nconst x = 1\nconst y = 2\n```\n'

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
    // The discriminator from CodeMirror's built-in foldAll: that command
    // would also fold the heading, swallowing this prose along with it.
    // Only the custom fold-all-code command leaves prose outside a fence
    // visible while folding the code block. Scoped to .editor-pane because
    // .preview-pane renders the raw markdown independently of CodeMirror's
    // fold state and would contain the prose regardless of which command ran.
    expect(target.querySelector('.editor-pane')?.textContent).toContain(
      'Some prose that explains the numbers.',
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

describe('chart builder', () => {
  const WITH_CHART = [
    '# Results',
    '',
    '```vega-lite',
    '{"data": {"values": [{"a": 1}]}, "mark": "line", "encoding": {"x": {"field": "a", "type": "quantitative"}, "y": {"field": "a", "type": "quantitative"}}}',
    '```',
    '',
  ].join('\n')

  const WITH_TRANSFORM = [
    '# Results',
    '',
    '```vega-lite',
    '{"data": {"values": []}, "transform": [{"filter": "true"}], "mark": "line"}',
    '```',
    '',
  ].join('\n')

  async function openDoc(content: string) {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))
    return target
  }

  it('opens an empty builder from prose', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    expect(target.textContent).toContain('Insert chart')
  })

  it('prefills the builder when the cursor is inside a chart block', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_CHART.indexOf('"mark"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Update chart')
  })

  it('refuses a spec it cannot model and leaves the document untouched', async () => {
    const target = await openDoc(WITH_TRANSFORM)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const before = view.state.doc.toString()
    view.dispatch({ selection: { anchor: WITH_TRANSFORM.indexOf('"filter"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    expect(target.querySelector('.chart-builder')).toBeNull()
    expect(target.textContent).toContain('transform')
    expect(view.state.doc.toString()).toBe(before)
  })

  it('inserts a fenced block at the cursor on commit', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    const box = target.querySelector<HTMLTextAreaElement>('#chart-paste')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    for (const [field, value] of [
      ['x', 'dose'],
      ['y', 'response'],
    ]) {
      const el = target.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      flushSync()
    }
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert chart')!
      .click()
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const doc = view.state.doc.toString()
    expect(doc).toContain('```vega-lite')
    expect(doc).toContain('"field": "dose"')
    expect(target.querySelector('.chart-builder')).toBeNull()
  })

  // Critical finding: commitChart's insert branch called editor.insertAtCursor,
  // a bare replaceSelection with no leading newline. Leaving the cursor
  // mid-line (the ordinary place it sits after typing a sentence) and
  // inserting a chart merged the fence into the prose line — markdown then
  // rendered the whole dataset as visible text, and Lezer would not parse it
  // as a FencedCode node, so the builder could never reopen it. This is the
  // path that broke; it now goes through insertBlockAtCursor instead.
  it('inserts on its own line even when the cursor sits mid-line, not merged into the prose', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const midLine = view.state.doc.toString().indexOf('Just prose.') + 'Just prose.'.length
    view.dispatch({ selection: { anchor: midLine } })

    listeners['menu:insert-chart']({ data: null })
    flushSync()

    const box = target.querySelector<HTMLTextAreaElement>('#chart-paste')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    for (const [field, value] of [
      ['x', 'dose'],
      ['y', 'response'],
    ]) {
      const el = target.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      flushSync()
    }
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert chart')!
      .click()
    flushSync()

    const doc = view.state.doc.toString()
    expect(doc).toMatch(/(^|\n)```vega-lite/)
    // The original sentence survives whole, on its own line — not merged
    // into the fence, which is what made the document unrenderable and the
    // block unreopenable.
    expect(doc.split('\n')).toContain('Just prose.')
  })

  it('does nothing from the welcome screen', async () => {
    recents.current = ['/tmp/paper.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).toBeNull()
  })

  it('opens targeting an empty fence rather than refusing it as invalid JSON', async () => {
    const target = await openDoc(['# Results', '', '```vega-lite', '```', ''].join('\n'))
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const content = view.state.doc.toString()
    view.dispatch({ selection: { anchor: content.indexOf('```vega-lite') + 5 } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    // Not refused, and not prefilled either — a fresh builder targeted at
    // replacing this block on commit.
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    expect(target.textContent).toContain('Insert chart')
  })

  it('replaces exactly the target block in place on an edited-chart commit, leaving prose intact', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_CHART.indexOf('"mark"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Update chart')

    const markSelect = target.querySelector<HTMLSelectElement>('select[data-field="chart-type"]')!
    markSelect.value = 'bar'
    markSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update chart')!
      .click()
    flushSync()

    const doc = view.state.doc.toString()
    expect(target.querySelector('.chart-builder')).toBeNull()
    expect((doc.match(/```vega-lite/g) ?? []).length).toBe(1)
    expect(doc).toContain('"mark": "bar"')
    expect(doc).not.toContain('"mark": "line"')
    expect(doc).toContain('# Results')
  })

  // Critical finding: replaceRange used a stashed { from, to } blindly. The
  // chart-builder modal does not block the keyboard, so a stray edit reaching
  // the editor behind it — three characters typed inside the target block —
  // shifted the closing fence without the stashed range knowing, and commit
  // wrote using the stale offsets, leaving the old fence as garbage after the
  // new text. commitChart now re-validates the range against the live
  // document immediately before writing and refuses rather than corrupt it.
  it('refuses to commit when the target block changed while the builder was open', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const insidePos = WITH_CHART.indexOf('"mark"')
    view.dispatch({ selection: { anchor: insidePos } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Update chart')

    // Simulates a stray keystroke reaching the editor behind the modal —
    // exactly what the paste-box autofocus in ChartBuilder.svelte exists to
    // prevent in the real app, and exactly what the commit-time validation
    // exists to catch if it happens anyway.
    view.dispatch({ changes: { from: insidePos, to: insidePos, insert: 'XYZ' } })
    const stray = view.state.doc.toString()

    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update chart')!
      .click()
    flushSync()

    expect(target.querySelector('.chart-builder')).toBeNull()
    expect(target.textContent).toContain("wasn't changed")
    // The document is exactly the stray edit — commit must refuse rather
    // than write using stale offsets, not merely avoid an obvious corruption.
    expect(view.state.doc.toString()).toBe(stray)
  })

  // Important finding: openChartBuilder had no re-entry guard. Firing
  // menu:insert-chart again while the builder is already open reassigned
  // chartTarget (even though chartInitial's new value would be silently
  // ignored, since ChartBuilder reads `initial` only once at mount) — so a
  // pending Insert silently turned into a Replace of whatever block the
  // cursor now sat in. openChartBuilder now no-ops while chartOpen is true.
  it('a second menu:insert-chart while already open does not turn Insert into Replace', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 0 } }) // in the heading, not inside the chart
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Insert chart')

    // Move into the existing chart and re-fire the menu — must be a no-op
    // while the builder is already open, not a switch to replace mode.
    view.dispatch({ selection: { anchor: WITH_CHART.indexOf('"mark"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Insert chart')

    // Cursor back to a safe prose position so the commit's outcome (insert
    // vs. replace) is unambiguous.
    view.dispatch({ selection: { anchor: 0 } })

    const box = target.querySelector<HTMLTextAreaElement>('#chart-paste')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    for (const [field, value] of [
      ['x', 'dose'],
      ['y', 'response'],
    ]) {
      const el = target.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      flushSync()
    }
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert chart')!
      .click()
    flushSync()

    const doc = view.state.doc.toString()
    // The original chart survives untouched, and a new one was inserted
    // alongside it — not in place of it.
    expect(doc).toContain('"field": "a"')
    expect(doc).toContain('"field": "dose"')
    expect((doc.match(/```vega-lite/g) ?? []).length).toBe(2)
  })

  // Minor finding: the builder could open on top of the unsaved-changes
  // confirm dialog, leaving that dialog's buttons keyboard-reachable behind a
  // modal with no focus trap. openChartBuilder now refuses while pendingAction
  // is set, same shape as its existing chartOpen/showWelcome guards.
  it('does not open the chart builder over the unsaved-changes confirm dialog', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } }) // make the document dirty
    flushSync()

    listeners['menu:new']({ data: null })
    flushSync()
    // The confirm dialog's content is always in the DOM (see the fix below),
    // so textContent can't tell shown from hidden — check the dialog's own
    // open state instead.
    expect(
      target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!.open,
    ).toBe(true) // confirm dialog is up

    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).toBeNull()
  })

  // Same robustness gap in the other direction: close:confirm fires
  // regardless of what else is on screen, so without a guard it could raise
  // the unsaved-changes dialog behind the chart modal.
  it('does not raise the unsaved-changes dialog while the chart builder is open', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()

    listeners['close:confirm']({ data: null })
    flushSync()

    // The unsaved-changes dialog is now a native <dialog> that App.svelte
    // renders unconditionally (Dialog owns visibility via the `open` prop,
    // not an {#if}), so its "has unsaved changes" text is always present in
    // the DOM regardless of whether pendingAction is set — a textContent
    // check can no longer distinguish shown from hidden. The guard under
    // test (chartOpen, in the close:confirm handler) is unchanged; only the
    // way to observe its effect changes: query the dialog's own open state.
    const confirmDialog = target.querySelector<HTMLDialogElement>(
      'dialog[aria-label="Unsaved changes"]',
    )!
    expect(confirmDialog.open).toBe(false)
    expect(target.querySelector('.chart-builder')).not.toBeNull()
  })

  // Deferred review finding, v0.8: the guard above was right but silent. ⌘Q
  // (and closing the window, which terminates the app too) did *nothing at
  // all* while the builder was open — no dialog, no message, no quit, no clue
  // which of those was intended. Refusing is still the right answer, because
  // closing the builder would throw away an in-progress chart without asking;
  // refusing invisibly is not.
  it('says why it refused the quit rather than swallowing it', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()

    listeners['close:confirm']({ data: null })
    flushSync()

    expect(target.textContent).toContain('Finish or cancel the chart before quitting')
    // Still refused, and the builder is still there to be finished.
    expect(
      target.querySelector<HTMLDialogElement>('dialog[aria-label="Unsaved changes"]')!.open,
    ).toBe(false)
    expect(target.querySelector('.chart-builder')).not.toBeNull()
  })

  // role="alertdialog" makes screen readers announce this dialog as a
  // destructive interruption rather than a plain dialog — dropped once
  // already in this branch and restored, hence a test to keep it that way.
  it('marks the unsaved-changes confirm dialog as an alertdialog', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const confirmDialog = target.querySelector<HTMLDialogElement>(
      'dialog[aria-label="Unsaved changes"]',
    )!
    expect(confirmDialog.getAttribute('role')).toBe('alertdialog')
  })
})

describe('insert code block', () => {
  async function openDoc(content: string) {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))
    return target
  }

  it('writes a fence carrying the language the menu named', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toContain('```python\n')
  })

  it('writes a bare fence for the Plain text item', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!

    listeners['menu:insert-code']({ data: '' })
    flushSync()

    expect(view.state.doc.toString()).toContain('```\n\n```')
  })

  // Menu events arrive from AppKit through Go's event bus and never touch the
  // DOM, so a modal cannot intercept them — the same reason applyFormat and
  // applyFold carry this guard.
  it('is refused while the chart builder is open', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    const before = view.state.doc.toString()

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toBe(before)
  })

  it('does nothing from the welcome screen', async () => {
    recents.current = ['/tmp/paper.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const before = view.state.doc.toString()

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toBe(before)
  })
})

describe('export PDF', () => {
  // The export dialog names the file after the document, so the path has to
  // reach Go. Nothing static can catch a regression here: ExportPDF's
  // parameter is a plain string, so passing null for an unsaved document
  // would type-check and produce a nonsense filename.
  it('passes an empty path when no document is open', async () => {
    recents.current = ['/papers/thesis.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:export-pdf']({ data: null })
    flushSync()

    expect(DocumentService.ExportPDF).toHaveBeenCalledWith('')
  })

  it('passes the open document’s path once one is open', async () => {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({
      path: '/tmp/paper.md',
      content: '# Results\n',
    })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))

    listeners['menu:export-pdf']({ data: null })
    flushSync()

    expect(DocumentService.ExportPDF).toHaveBeenCalledWith('/tmp/paper.md')
  })
})

describe('figure settings', () => {
  it('publishes the persisted alignment onto the preview pane', async () => {
    settings.current = { ...DEFAULT_SETTINGS, figureAlignment: 'right' }
    recents.current = []
    stubMatchMedia(false)
    const { target } = mountApp()

    await vi.waitFor(() =>
      expect(
        target.querySelector<HTMLElement>('.preview-pane')!.dataset.figureAlign,
      ).toBe('right'),
    )
  })

  it('re-renders the preview when the menu changes the chart width', async () => {
    settings.current = { ...DEFAULT_SETTINGS }
    recents.current = []
    stubMatchMedia(false)
    const { target } = mountApp()
    const pane = target.querySelector<HTMLElement>('.preview-pane')!

    // A chart in the document is what makes the width observable at all.
    const editor = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    // Empty recents triggers App's own first-launch doNew(), which lands
    // asynchronously (after refreshRecents/refreshSettings resolve) and would
    // otherwise clobber a dispatch made before it settles. Wait for it first.
    await vi.waitFor(() => expect(editor.state.doc.length).toBeGreaterThan(0))
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: '```vega-lite\n{"mark":"bar"}\n```\n' },
    })
    await vi.waitFor(() =>
      expect(pane.querySelector('.vega-lite-chart')?.getAttribute('data-spec')).toContain(
        '"width":400',
      ),
    )

    settings.current = { ...DEFAULT_SETTINGS, chartWidth: 'large' }
    listeners['settings:changed']({ data: null })

    await vi.waitFor(() =>
      expect(pane.querySelector('.vega-lite-chart')?.getAttribute('data-spec')).toContain(
        '"width":560',
      ),
    )
  })
})
