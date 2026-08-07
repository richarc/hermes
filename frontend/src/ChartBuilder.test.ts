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

// Controllable stand-in for the real embedChart, which under jsdom resolves
// to null anyway (no canvas context) — mocking it here isn't a workaround for
// that, it's what lets the mid-embed-teardown leak test resolve the embed
// promise at an exact, chosen instant instead of racing jsdom's real
// vega-embed/canvas failure path. Every other test gets the default
// immediately-null behaviour, same as the real thing under jsdom.
const { embedChart } = vi.hoisted(() => ({
  embedChart: vi.fn(
    (): Promise<{ finalize: () => void } | null> => Promise.resolve(null),
  ),
}))
vi.mock('./lib/charts', () => ({ embedChart }))

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

beforeEach(() => {
  ImportData.mockReset()
  // Clear call history only — mockClear (not mockReset) preserves the
  // default `() => Promise.resolve(null)` implementation every other test
  // relies on; only the leak test below overrides it, and only once.
  embedChart.mockClear()
})

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
    await vi.waitFor(() => expect(target.textContent).toContain('nope'))
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    cleanup()
  })

  // Important finding: chooseFile's catch discarded the rejection and always
  // showed "Couldn't read that file.", even though Go's readDataFile composes
  // a specific message for the size cap ("that file is 40 MB; the limit is
  // 25 MB…"). That entire error path was unreachable to users — a deliberate,
  // explainable limit read as file corruption. Surface the real message.
  it('surfaces the actual error message from a rejected import, not a generic string', async () => {
    ImportData.mockRejectedValueOnce(
      new Error('that file is 40 MB; the limit is 25 MB because the data is stored in the document'),
    )
    const { target, cleanup } = mountBuilder()
    const button = [...target.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Choose file'),
    )!
    button.click()
    await vi.waitFor(() =>
      expect(target.textContent).toContain('the limit is 25 MB because the data is stored'),
    )
    cleanup()
  })

  it('clears a stale import error when a second import is attempted', async () => {
    ImportData.mockRejectedValueOnce(new Error('nope'))
    const { target, cleanup } = mountBuilder()
    const button = [...target.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Choose file'),
    )!
    button.click()
    await vi.waitFor(() => expect(target.textContent).toContain('nope'))

    ImportData.mockImplementationOnce(() => new Promise(() => {})) // never resolves
    button.click()
    flushSync()
    expect(target.textContent).not.toContain('nope')
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

function select(target: HTMLElement, label: string, value: string) {
  const el = target.querySelector<HTMLSelectElement>(`select[data-field="${label}"]`)!
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
}

describe('ChartBuilder encoding step', () => {
  it('offers every column as an x and y choice once data is loaded', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    const x = target.querySelector<HTMLSelectElement>('select[data-field="x"]')!
    // Leading '' is the disabled "choose a column…" placeholder — present so
    // a fresh paste reads as unset rather than blank-and-broken, but never a
    // real, selectable column.
    expect([...x.options].map((o) => o.value)).toEqual(['', 'dose', 'response'])
    cleanup()
  })

  // Minor finding: xField/yField start as '' with no matching <option>, so
  // both selects rendered blank on a fresh paste — reading as broken rather
  // than merely unset. A disabled placeholder option now makes '' a real,
  // displayed choice, without ever being auto-selectable (Insert disabled
  // above already guards that no real column gets picked for you).
  it('shows a disabled placeholder in the x and y selects before a column is chosen', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    for (const field of ['x', 'y']) {
      const el = target.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!
      const placeholder = el.options[0]
      expect(placeholder.value).toBe('')
      expect(placeholder.disabled).toBe(true)
      expect(el.value).toBe('')
    }
    cleanup()
  })

  it('keeps Insert disabled until both axes are chosen', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    const insert = [...target.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Insert chart',
    )!
    expect(insert.disabled).toBe(true)
    select(target, 'x', 'dose')
    select(target, 'y', 'response')
    expect(insert.disabled).toBe(false)
    cleanup()
  })

  it('hands the generated spec to oncommit', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const oncommit = vi.fn()
    const cmp = mount(ChartBuilder, {
      target,
      props: { initial: null, oncommit, oncancel: vi.fn() },
    })
    flushSync()
    paste(target, 'dose,response\n0,1\n5,2\n')
    select(target, 'x', 'dose')
    select(target, 'y', 'response')
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert chart')!
      .click()
    flushSync()

    expect(oncommit).toHaveBeenCalledTimes(1)
    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect(spec.mark).toBe('line')
    expect(spec.encoding.x.field).toBe('dose')
    expect(spec.encoding.y.field).toBe('response')
    expect(spec.data.values).toHaveLength(2)
    unmount(cmp)
    target.remove()
  })

  it('prefills from an existing chart and labels the action as an update', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          mark: 'bar',
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative', title: '' },
          y: { field: 'response', type: 'quantitative', title: '', aggregate: 'none' },
          colour: null,
        },
        oncommit: vi.fn(),
        oncancel: vi.fn(),
      },
    })
    flushSync()
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x"]')!.value).toBe('dose')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="mark"]')!.value).toBe('bar')
    expect(target.textContent).toContain('Update chart')
    unmount(cmp)
    target.remove()
  })

  it('hides the aggregate control for boxplot, which summarises for itself', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    select(target, 'mark', 'boxplot')
    expect(target.querySelector('select[data-field="aggregate"]')).toBeNull()
    cleanup()
  })

  it('seeds the field type from inference when a column is picked', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'label,score\na,1\nb,2\n')
    select(target, 'x', 'label')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x-type"]')!.value).toBe(
      'nominal',
    )
    select(target, 'x', 'score')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x-type"]')!.value).toBe(
      'quantitative',
    )
    cleanup()
  })

  it('lets the user override an inferred type, and uses the override', () => {
    // An integer ID column infers as quantitative but is really nominal; only
    // the author knows that, so the override has to reach the spec.
    const target = document.createElement('div')
    document.body.appendChild(target)
    const oncommit = vi.fn()
    const cmp = mount(ChartBuilder, {
      target,
      props: { initial: null, oncommit, oncancel: vi.fn() },
    })
    flushSync()
    paste(target, 'id,score\n1,10\n2,20\n')
    select(target, 'x', 'id')
    select(target, 'y', 'score')
    select(target, 'x-type', 'nominal')
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert chart')!
      .click()
    flushSync()

    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect(spec.encoding.x.type).toBe('nominal')
    unmount(cmp)
    target.remove()
  })

  it('drops readiness when switching to boxplot cancels out a count aggregate chosen for a hidden y', () => {
    // Regression for: pick x, choose the count aggregate (valid without a y
    // field), then switch to boxplot — which ignores aggregate entirely and
    // summarises the field itself. Readiness must track the same effective
    // aggregate the committed spec uses, or Insert stays enabled for a state
    // that serialises to an empty, invalid y encoding.
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    select(target, 'x', 'dose')
    select(target, 'aggregate', 'count')
    const insert = [...target.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Insert chart',
    )!
    expect(insert.disabled).toBe(false)
    select(target, 'mark', 'boxplot')
    expect(insert.disabled).toBe(true)
    cleanup()
  })

  it('clears a stale axis selection when a re-paste changes the columns', () => {
    // Regression for: paste a table, pick both axes, then paste a table with
    // entirely different columns. The old field names must not survive into
    // readiness or a committed spec once they no longer exist.
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    select(target, 'x', 'dose')
    select(target, 'y', 'response')
    const insert = [...target.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Insert chart',
    )!
    expect(insert.disabled).toBe(false)

    paste(target, 'alpha,beta\n1,2\n3,4\n')

    const x = target.querySelector<HTMLSelectElement>('select[data-field="x"]')!
    expect([...x.options].map((o) => o.value)).toEqual(['', 'alpha', 'beta'])
    expect(insert.disabled).toBe(true)
    cleanup()
  })

  it('finalizes a view whose embed resolves after the modal is torn down', async () => {
    // Regression for: cancel while the preview's embedChart() is still
    // pending. Teardown must invalidate the in-flight pass so its eventual
    // resolution finalizes itself instead of assigning into a `view`
    // nothing will ever read again — otherwise every cancel-mid-embed leaks
    // one Vega view (listeners, timers) for the life of the session.
    let resolveEmbed: (view: { finalize: () => void } | null) => void = () => {}
    const finalize = vi.fn()
    embedChart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEmbed = resolve
        }),
    )

    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: { initial: null, oncommit: vi.fn(), oncancel: vi.fn() },
    })
    flushSync()
    paste(target, 'dose,response\n0,1\n5,2\n')
    select(target, 'x', 'dose')
    select(target, 'y', 'response')
    flushSync()
    expect(embedChart).toHaveBeenCalledTimes(1)

    unmount(cmp)
    resolveEmbed({ finalize })
    await Promise.resolve()
    await Promise.resolve()

    expect(finalize).toHaveBeenCalledTimes(1)
    target.remove()
  })
})
