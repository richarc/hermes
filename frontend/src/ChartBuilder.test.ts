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
    (_el: HTMLElement, _specText: string): Promise<{ finalize: () => void } | null> =>
      Promise.resolve(null),
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
          chartType: 'bar',
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative', title: '' },
          y: { field: 'response', type: 'quantitative', title: '', aggregate: 'none' },
          colour: null,
          extent: 'ci' as const,
          extras: {},
        },
        oncommit: vi.fn(),
        oncancel: vi.fn(),
      },
    })
    flushSync()
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x"]')!.value).toBe('dose')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="chart-type"]')!.value).toBe('bar')
    expect(target.textContent).toContain('Update chart')
    unmount(cmp)
    target.remove()
  })

  it('hides the aggregate control for boxplot, which summarises for itself', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    select(target, 'chart-type', 'boxplot')
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
    select(target, 'chart-type', 'boxplot')
    expect(insert.disabled).toBe(true)
    cleanup()
  })

  it('cannot commit once a re-paste changes the columns an axis selection names', () => {
    // Regression for: paste a table, pick both axes, then paste a table with
    // entirely different columns. Selections are no longer cleared when their
    // column disappears (clearing on every keystroke is what discarded a
    // declared type override mid-edit — see the header-rename test below), so
    // this pins the property that clearing used to provide by a different
    // route: `ready` must refuse a spec that would encode a column absent
    // from the current data, whether or not the stale selection is cleared.
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

/** Types into a text input the way a user would. */
function typeInto(target: HTMLElement, field: string, value: string) {
  const el = target.querySelector<HTMLInputElement>(`input[data-field="${field}"]`)!
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

/** A ready-to-commit builder: data pasted and both axes chosen. */
function readyBuilder(oncommit = vi.fn()) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(ChartBuilder, {
    target,
    props: { initial: null, oncommit, oncancel: vi.fn() },
  })
  flushSync()
  paste(target, 'dose,response\n0,1\n5,2\n')
  select(target, 'x', 'dose')
  select(target, 'y', 'response')
  return {
    target,
    oncommit,
    commit: () => {
      const button = [...target.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Insert chart',
      )!
      button.click()
      flushSync()
    },
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

describe('ChartBuilder caption', () => {
  it('writes the caption into the spec title, where the renderer reads it', () => {
    const b = readyBuilder()
    typeInto(b.target, 'caption', 'Recovered sources')
    b.commit()
    const spec = JSON.parse(b.oncommit.mock.calls[0][0] as string)
    expect(spec.title).toBe('Recovered sources')
    b.cleanup()
  })

  it('commits no title at all when the caption is left empty', () => {
    const b = readyBuilder()
    b.commit()
    const spec = JSON.parse(b.oncommit.mock.calls[0][0] as string)
    expect('title' in spec).toBe(false)
    b.cleanup()
  })

  it('prefills the caption when reopening a captioned chart', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          chartType: 'bar' as const,
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative' as const, title: '' },
          y: {
            field: 'response',
            type: 'quantitative' as const,
            title: '',
            aggregate: 'none' as const,
          },
          colour: null,
          extent: 'ci' as const,
          extras: { title: 'Recovered sources' },
        },
        oncommit: vi.fn(),
        oncancel: vi.fn(),
      },
    })
    flushSync()
    expect(target.querySelector<HTMLInputElement>('input[data-field="caption"]')!.value).toBe(
      'Recovered sources',
    )
    unmount(cmp)
    target.remove()
  })

  it('clears the title when the caption is emptied', () => {
    const oncommit = vi.fn()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          chartType: 'bar' as const,
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative' as const, title: '' },
          y: {
            field: 'response',
            type: 'quantitative' as const,
            title: '',
            aggregate: 'none' as const,
          },
          colour: null,
          extent: 'ci' as const,
          extras: { title: 'Recovered sources' },
        },
        oncommit,
        oncancel: vi.fn(),
      },
    })
    flushSync()
    typeInto(target, 'caption', '')
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update chart')!
      .click()
    flushSync()
    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect('title' in spec).toBe(false)
    unmount(cmp)
    target.remove()
  })

  it('leaves a title the field cannot show as text untouched', () => {
    // An object title with styling is inert metadata readSpec preserved.
    // Clearing it because the text box showed nothing would be silent loss.
    const oncommit = vi.fn()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          chartType: 'bar' as const,
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative' as const, title: '' },
          y: {
            field: 'response',
            type: 'quantitative' as const,
            title: '',
            aggregate: 'none' as const,
          },
          colour: null,
          extent: 'ci' as const,
          extras: { title: { text: 42 } },
        },
        oncommit,
        oncancel: vi.fn(),
      },
    })
    flushSync()
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update chart')!
      .click()
    flushSync()
    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect(spec.title).toEqual({ text: 42 })
    unmount(cmp)
    target.remove()
  })

  it('leaves an unedited renderable object title as an object, not flattened to a string', () => {
    // The realistic case a real user hits, unlike the exotic { text: 42 }
    // above: the caption box shows 'X' and, left untouched, must commit the
    // spec's title back exactly as it was — an object — not the plain string
    // the box's own text would otherwise suggest.
    const oncommit = vi.fn()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          chartType: 'bar' as const,
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative' as const, title: '' },
          y: {
            field: 'response',
            type: 'quantitative' as const,
            title: '',
            aggregate: 'none' as const,
          },
          colour: null,
          extent: 'ci' as const,
          extras: { title: { text: 'X' } },
        },
        oncommit,
        oncancel: vi.fn(),
      },
    })
    flushSync()
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update chart')!
      .click()
    flushSync()
    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect(spec.title).toEqual({ text: 'X' })
    unmount(cmp)
    target.remove()
  })

  it('previews the caption below the chart, not inside it', () => {
    // Mirrors the document: the title is stripped from the embedded spec and
    // the caption is drawn as text beneath.
    const b = readyBuilder()
    typeInto(b.target, 'caption', 'Recovered sources')
    const lastSpec = JSON.parse(embedChart.mock.calls.at(-1)![1] as string)
    expect('title' in lastSpec).toBe(false)
    expect(b.target.querySelector('.chart-caption')?.textContent).toBe('Recovered sources')
    b.cleanup()
  })
})

/** Mounts a builder reopened on an existing chart. */
function reopened(
  rows: Record<string, string | number>[],
  overrides: { xType?: 'quantitative' | 'temporal' | 'nominal' } = {},
  oncommit = vi.fn(),
) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(ChartBuilder, {
    target,
    props: {
      initial: {
        chartType: 'bar' as const,
        rows,
        x: { field: 'dose', type: overrides.xType ?? ('quantitative' as const), title: '' },
        y: {
          field: 'response',
          type: 'quantitative' as const,
          title: '',
          aggregate: 'none' as const,
        },
        colour: null,
        extent: 'ci' as const,
        extras: {},
      },
      oncommit,
      oncancel: vi.fn(),
    },
  })
  flushSync()
  return {
    target,
    oncommit,
    box: target.querySelector<HTMLTextAreaElement>('textarea')!,
    update: () => {
      ;[...target.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Update chart')!
        .click()
      flushSync()
    },
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

describe('ChartBuilder data box on reopen', () => {
  it('prefills the box with the chart’s own data', () => {
    // Without this the box opens empty and auto-focused, and the first
    // keystroke replaces the seeded table with a one-column, no-row table.
    const r = reopened([
      { dose: 0, response: 1.5 },
      { dose: 5, response: 3.25 },
    ])
    expect(r.box.value).toBe('dose,response\n0,1.5\n5,3.25')
    r.cleanup()
  })

  it('still opens empty for a new chart', () => {
    const { target, cleanup } = mountBuilder()
    expect(target.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('')
    cleanup()
  })

  it('commits a row added to the prefilled text', () => {
    const r = reopened([{ dose: 0, response: 1.5 }])
    paste(r.target, r.box.value + '\n5,3.25')
    r.update()
    const spec = JSON.parse(r.oncommit.mock.calls[0][0] as string)
    expect(spec.data.values).toEqual([
      { dose: 0, response: 1.5 },
      { dose: 5, response: 3.25 },
    ])
    r.cleanup()
  })

  it('commits a value edited in the prefilled text', () => {
    const r = reopened([{ dose: 0, response: 1.5 }])
    paste(r.target, 'dose,response\n0,99')
    r.update()
    const spec = JSON.parse(r.oncommit.mock.calls[0][0] as string)
    expect(spec.data.values).toEqual([{ dose: 0, response: 99 }])
    r.cleanup()
  })

  it('keeps a declared type override when the data text is edited', () => {
    // Re-parsing re-infers the TABLE's column type, but the chart's type is
    // separate state that load() never touches. A refactor that started
    // reading types off the table would break this silently.
    const r = reopened([{ dose: 1, response: 1 }], { xType: 'nominal' })
    paste(r.target, 'dose,response\n1,1\n2,2')
    r.update()
    const spec = JSON.parse(r.oncommit.mock.calls[0][0] as string)
    expect(spec.encoding.x.type).toBe('nominal')
    r.cleanup()
  })

  it('keeps a declared type override through a keystroke-by-keystroke header rename back to the same name', () => {
    // Important finding: load() runs on every keystroke, so selecting the
    // header cell and retyping it renames the column away and back one
    // character at a time. The old rule cleared xField the instant the name
    // first changed and nothing ever restored it — re-picking the column from
    // the dropdown afterwards re-inferred its type from scratch (quantitative,
    // for a numeric-looking column), silently discarding the user's nominal
    // override even though the final header text matches what it started as.
    const r = reopened([{ dose: 1, response: 1 }], { xType: 'nominal' })
    for (const partial of ['d', 'do', 'dos', 'dose']) {
      paste(r.target, `${partial},response\n1,1`)
    }
    r.update()
    const spec = JSON.parse(r.oncommit.mock.calls[0][0] as string)
    expect(spec.encoding.x.field).toBe('dose')
    expect(spec.encoding.x.type).toBe('nominal')
    r.cleanup()
  })

  it('opens with an empty box rather than text that fails to re-parse, when a column name has no delimiter to sniff', () => {
    // Important finding: toDelimited's claim that its output "always
    // re-parses" is false for a table it did not itself produce. A
    // single-column table whose header contains whitespace but neither a
    // comma nor a tab serializes to text parseDelimited rejects as prose
    // ("Expected a comma- or tab-separated table with a header row.") — the
    // modal would open looking fine and then break on the very first
    // keystroke with an error the user did not cause. seedPasteText must
    // check before prefilling and fall back to '', same as an unseeded
    // builder.
    const r = reopened([{ 'Sales Region': 'North' }])
    expect(r.box.value).toBe('')
    expect(r.target.textContent).not.toContain('Expected a comma')
    r.cleanup()
  })
})

/** The dialog's confirming button, whose disabled state is readiness. */
function insertBtn(target: HTMLElement): HTMLButtonElement {
  return [...target.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Insert chart',
  )! as HTMLButtonElement
}

describe('chart type form', () => {
  it('offers every chart type', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'day,hour,rate\nMon,9,1\n')
    const options = [...target.querySelectorAll('select[data-field="chart-type"] option')]
    expect(options).toHaveLength(11)
    expect(options.map((o) => o.getAttribute('value'))).toContain('histogram')
    cleanup()
  })

  it('hides the Y control for a histogram, whose Y is always the count', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'mass\n1\n2\n')
    select(target, 'chart-type', 'histogram')
    expect(target.querySelector('select[data-field="y"]')).toBeNull()
    cleanup()
  })

  it('shows an extent control only for error bars', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'a,b\nx,1\n')
    expect(target.querySelector('select[data-field="extent"]')).toBeNull()
    select(target, 'chart-type', 'errorbar')
    expect(target.querySelector('select[data-field="extent"]')).not.toBeNull()
    cleanup()
  })

  it('relabels the value and category controls for a pie', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'category,count\na,1\n')
    select(target, 'chart-type', 'pie')
    expect(target.textContent).toContain('Slice size')
    expect(target.textContent).toContain('Category')
    expect(target.querySelector('select[data-field="x"]')).toBeNull()
    cleanup()
  })

  it('requires a colour value for a heatmap', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'day,hour,rate\nMon,9,1\n')
    select(target, 'chart-type', 'heatmap')
    select(target, 'x', 'day')
    select(target, 'y', 'hour')
    expect(insertBtn(target).disabled).toBe(true)
    select(target, 'colour', 'rate')
    expect(insertBtn(target).disabled).toBe(false)
    cleanup()
  })

  // The annoyance a naive implementation ships: switching type should not
  // empty a form the author has already filled in.
  it('keeps column selections when the chart type changes', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n')
    select(target, 'x', 'dose')
    select(target, 'y', 'response')
    select(target, 'chart-type', 'errorbar')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x"]')!.value).toBe('dose')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="y"]')!.value).toBe(
      'response',
    )
    cleanup()
  })
})
