<script lang="ts">
  import { untrack } from 'svelte'
  import { parseDelimited, tableFromRows, type DataTable, type FieldType } from './lib/dataTable'
  import { buildSpec, MARKS, AGGREGATES, type Mark, type Aggregate, type BuilderState } from './lib/chartSpec'
  import { embedChart, type ChartView } from './lib/charts'
  import { DocumentService } from '../bindings/hermes'

  interface Props {
    initial: BuilderState | null
    oncommit: (spec: string) => void
    oncancel: () => void
  }

  const { initial, oncommit, oncancel }: Props = $props()

  // Above this many rows the document gets unwieldy, but aggregation makes a
  // large raw table a legitimate input — so this warns and does not block.
  const ROW_WARNING = 5000

  interface Seed {
    table: DataTable | null
    mark: Mark
    xField: string
    yField: string
    colourField: string
    xTitle: string
    yTitle: string
    aggregate: Aggregate
    xType: FieldType
    yType: FieldType
    colourType: FieldType
  }

  // Every field below is read once, synchronously, while constructing this
  // component's starting state: the modal is recreated (never updated) on
  // each open, so none of it should ever react to a later `initial` change.
  // `untrack` states that read-once intent explicitly instead of leaving it
  // to a comment, which also satisfies svelte-check's
  // `state_referenced_locally` warning instead of accepting it repeatedly.
  //
  // Reopening an existing chart arrives with rows already parsed, so the
  // paste box starts empty and the table is seeded from the spec. The
  // encoded columns (x/y/colour) already carry an authoritative type read
  // out of the spec — trust those rather than re-guessing, since a guess
  // from row values alone cannot tell a date column from a nominal one
  // reliably.
  const seed: Seed = untrack(() => {
    let seededTable: DataTable | null = null
    if (initial) {
      const { x, y, colour, rows } = initial
      const knownTypes: Record<string, FieldType> = {}
      if (x.field) knownTypes[x.field] = x.type
      if (y.field) knownTypes[y.field] = y.type
      if (colour?.field) knownTypes[colour.field] = colour.type
      seededTable = tableFromRows(rows, knownTypes)
    }
    return {
      table: seededTable,
      mark: initial?.mark ?? 'line',
      xField: initial?.x.field ?? '',
      yField: initial?.y.field ?? '',
      colourField: initial?.colour?.field ?? '',
      xTitle: initial?.x.title ?? '',
      yTitle: initial?.y.title ?? '',
      aggregate: initial?.y.aggregate ?? 'none',
      xType: initial?.x.type ?? 'nominal',
      yType: initial?.y.type ?? 'quantitative',
      colourType: initial?.colour?.type ?? 'nominal',
    }
  })

  let pasted = $state('')
  let table: DataTable | null = $state(seed.table)
  let parseError = $state('')
  let importError = $state('')

  function load(text: string) {
    importError = ''
    if (text.trim() === '') {
      table = null
      parseError = ''
      return
    }
    const result = parseDelimited(text)
    if (result.ok) {
      table = result.table
      parseError = ''
      // A fresh paste can replace the columns entirely (different header
      // row). A selection that named a column from the old table is no
      // longer meaningful once that column is gone — clear it rather than
      // silently keeping a stale field name selected while the dropdown
      // shows something else, which would let Insert commit a spec that
      // encodes a column absent from the new data.
      const names = new Set(table.columns.map((c) => c.name))
      if (!names.has(xField)) xField = ''
      if (!names.has(yField)) yField = ''
      if (colourField && !names.has(colourField)) colourField = ''
    } else {
      table = null
      parseError = result.message
    }
  }

  function onPaste(event: Event) {
    pasted = (event.currentTarget as HTMLTextAreaElement).value
    load(pasted)
  }

  async function chooseFile() {
    importError = ''
    try {
      const text = await DocumentService.ImportData()
      if (text) {
        pasted = text
        load(text)
      }
    } catch (err) {
      // Go's readDataFile composes a specific message for the size cap
      // ("that file is N MB; the limit is M MB…") — surface it rather than
      // a generic string, which would read as corruption instead of a
      // deliberate, explainable limit.
      const message = err instanceof Error ? err.message : String(err)
      importError = message || "Couldn't read that file."
    }
  }

  const FIELD_TYPES: readonly FieldType[] = ['quantitative', 'temporal', 'nominal']

  let mark: Mark = $state(seed.mark)
  let xField = $state(seed.xField)
  let yField = $state(seed.yField)
  let colourField = $state(seed.colourField)
  let xTitle = $state(seed.xTitle)
  let yTitle = $state(seed.yTitle)
  let aggregate: Aggregate = $state(seed.aggregate)

  // Types are seeded from inference when a column is picked, then owned by the
  // user: an ID column of integers infers as quantitative but is really
  // nominal, and nothing but the author can know that.
  let xType: FieldType = $state(seed.xType)
  let yType: FieldType = $state(seed.yType)
  let colourType: FieldType = $state(seed.colourType)

  const columns = $derived(table?.columns ?? [])
  const typeOf = (name: string): FieldType =>
    columns.find((c) => c.name === name)?.type ?? 'nominal'

  function pickX(name: string) {
    xField = name
    xType = typeOf(name)
  }
  function pickY(name: string) {
    yField = name
    yType = typeOf(name)
  }
  function pickColour(name: string) {
    colourField = name
    if (name) colourType = typeOf(name)
  }

  // Boxplot computes its own summary and ignores an aggregate; builderState's
  // y.aggregate already substitutes 'none' for it, so readiness has to test
  // that same effective value rather than the raw control — otherwise
  // count+boxplot reads as ready (an aggregate is "selected") while the spec
  // it commits carries neither a field nor a real aggregate.
  const effectiveAggregate = $derived<Aggregate>(mark === 'boxplot' ? 'none' : aggregate)

  const ready = $derived(
    table !== null && xField !== '' && (yField !== '' || effectiveAggregate === 'count'),
  )

  // Named builderState rather than state: a local variable named `state`
  // collides with the `$state` rune elsewhere in the file — Svelte parses
  // `$state` as store auto-subscription of a variable named `state` once one
  // is in scope, which breaks every other `$state(...)` call in the script.
  const builderState: BuilderState | null = $derived(
    ready && table
      ? {
          mark,
          rows: table.rows,
          x: { field: xField, type: xType, title: xTitle },
          y: { field: yField, type: yType, title: yTitle, aggregate: effectiveAggregate },
          colour: colourField ? { field: colourField, type: colourType } : null,
        }
      : null,
  )

  let previewEl: HTMLDivElement | undefined = $state()
  let view: ChartView | null = null
  let generation = 0

  // Mirrors charts.ts: a newer pass invalidates an older one, so a slow embed
  // cannot overwrite a faster later one. Bumping generation on the early-out
  // path too means an embed already in flight when the table/selection is
  // cleared takes the stale branch on arrival and finalizes itself, instead
  // of resurrecting a view for a chart that is no longer showing.
  $effect(() => {
    const s = builderState
    const el = previewEl
    if (!s || !el) {
      generation++
      view?.finalize()
      view = null
      return
    }
    const gen = ++generation
    void embedChart(el, buildSpec(s)).then((v) => {
      if (gen !== generation) {
        v?.finalize()
        return
      }
      view?.finalize()
      view = v
    })
  })

  // Teardown bumps generation first so an embed still in flight when the
  // modal closes takes the stale branch on arrival and finalizes itself
  // rather than assigning into a `view` nothing will ever read again.
  $effect(() => () => {
    generation++
    view?.finalize()
  })

  function commit() {
    if (builderState) oncommit(buildSpec(builderState))
  }

  let pasteEl: HTMLTextAreaElement | undefined = $state()

  // The modal sits over a full-document editor whose keyboard shortcuts
  // (menu accelerators aside) still work if focus is left behind: stray
  // typing must land here, not in the document underneath. The paste box is
  // also where the user goes first, so this doubles as sensible default
  // focus. Runs once: pasteEl is only ever assigned by the initial mount.
  $effect(() => {
    pasteEl?.focus()
  })
</script>

<div class="modal-backdrop">
  <div class="chart-builder modal" role="dialog" aria-label="Chart builder">
    <h2>Chart</h2>

    <section class="data-step">
      <label for="chart-paste">Paste a table</label>
      <textarea id="chart-paste" bind:this={pasteEl} rows="6" value={pasted} oninput={onPaste}></textarea>
      <button onclick={() => void chooseFile()}>Choose file…</button>

      {#if parseError}
        <p class="field-error" role="alert">{parseError}</p>
      {/if}
      {#if importError}
        <p class="field-error" role="alert">{importError}</p>
      {/if}
      {#if table}
        <p class="data-summary">
          {table.columns.length} columns, {table.rows.length} rows
          {#if table.rows.length > ROW_WARNING}
            — that is a large table to store in the document, but it will work.
          {/if}
        </p>
      {/if}
    </section>

    {#if table}
      <section class="encode-step">
        <label class="mark-row">Mark
          <select data-field="mark" bind:value={mark}>
            {#each MARKS as m (m)}<option value={m}>{m}</option>{/each}
          </select>
        </label>

        <label>X
          <select data-field="x" value={xField} onchange={(e) => pickX(e.currentTarget.value)}>
            <option value="" disabled>choose a column…</option>
            {#each columns as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
          </select>
        </label>
        <label>X type
          <select data-field="x-type" bind:value={xType}>
            {#each FIELD_TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </label>
        <label>X title <input data-field="x-title" bind:value={xTitle} /></label>

        <label>Y
          <select data-field="y" value={yField} onchange={(e) => pickY(e.currentTarget.value)}>
            <option value="" disabled>choose a column…</option>
            {#each columns as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
          </select>
        </label>
        <label>Y type
          <select data-field="y-type" bind:value={yType}>
            {#each FIELD_TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </label>
        <label>Y title <input data-field="y-title" bind:value={yTitle} /></label>

        {#if mark !== 'boxplot'}
          <label>Aggregate
            <select data-field="aggregate" bind:value={aggregate}>
              {#each AGGREGATES as a (a)}<option value={a}>{a}</option>{/each}
            </select>
          </label>
        {/if}

        <label>Colour
          <select
            data-field="colour"
            value={colourField}
            onchange={(e) => pickColour(e.currentTarget.value)}
          >
            <option value="">none</option>
            {#each columns as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
          </select>
        </label>
      </section>

      <div class="chart-preview" bind:this={previewEl}></div>
    {/if}

    <div class="modal-buttons">
      <button onclick={oncancel}>Cancel</button>
      <button disabled={!ready} onclick={commit}>
        {initial ? 'Update chart' : 'Insert chart'}
      </button>
    </div>
  </div>
</div>
