<script lang="ts">
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

  let pasted = $state('')
  let table: DataTable | null = $state(null)
  let parseError = $state('')
  let importError = $state('')

  // Reopening an existing chart arrives with rows already parsed, so the paste
  // box starts empty and the table is seeded from the spec. The encoded
  // columns (x/y/colour) already carry an authoritative type read out of the
  // spec — trust those rather than re-guessing, since a guess from row
  // values alone cannot tell a date column from a nominal one reliably.
  if (initial) {
    const { x, y, colour, rows } = initial
    const knownTypes: Record<string, FieldType> = {}
    if (x.field) knownTypes[x.field] = x.type
    if (y.field) knownTypes[y.field] = y.type
    if (colour?.field) knownTypes[colour.field] = colour.type
    table = tableFromRows(rows, knownTypes)
  }

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
    try {
      const text = await DocumentService.ImportData()
      if (text) {
        pasted = text
        load(text)
      }
    } catch {
      importError = "Couldn't read that file."
    }
  }

  const FIELD_TYPES: readonly FieldType[] = ['quantitative', 'temporal', 'nominal']

  let mark: Mark = $state(initial?.mark ?? 'line')
  let xField = $state(initial?.x.field ?? '')
  let yField = $state(initial?.y.field ?? '')
  let colourField = $state(initial?.colour?.field ?? '')
  let xTitle = $state(initial?.x.title ?? '')
  let yTitle = $state(initial?.y.title ?? '')
  let aggregate: Aggregate = $state(initial?.y.aggregate ?? 'none')

  // Types are seeded from inference when a column is picked, then owned by the
  // user: an ID column of integers infers as quantitative but is really
  // nominal, and nothing but the author can know that.
  let xType: FieldType = $state(initial?.x.type ?? 'nominal')
  let yType: FieldType = $state(initial?.y.type ?? 'quantitative')
  let colourType: FieldType = $state(initial?.colour?.type ?? 'nominal')

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

  const ready = $derived(table !== null && xField !== '' && (yField !== '' || aggregate === 'count'))

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
          y: {
            field: yField,
            type: yType,
            title: yTitle,
            aggregate: mark === 'boxplot' ? 'none' : aggregate,
          },
          colour: colourField ? { field: colourField, type: colourType } : null,
        }
      : null,
  )

  let previewEl: HTMLDivElement | undefined = $state()
  let view: ChartView | null = null
  let generation = 0

  // Mirrors charts.ts: a newer pass invalidates an older one, so a slow embed
  // cannot overwrite a faster later one.
  $effect(() => {
    const s = builderState
    const el = previewEl
    if (!s || !el) return
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

  $effect(() => () => view?.finalize())

  function commit() {
    if (builderState) oncommit(buildSpec(builderState))
  }
</script>

<div class="modal-backdrop">
  <div class="chart-builder modal" role="dialog" aria-label="Chart builder">
    <h2>Chart</h2>

    <section class="data-step">
      <label for="chart-paste">Paste a table</label>
      <textarea id="chart-paste" rows="6" value={pasted} oninput={onPaste}></textarea>
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
        <label>Mark
          <select data-field="mark" bind:value={mark}>
            {#each MARKS as m (m)}<option value={m}>{m}</option>{/each}
          </select>
        </label>

        <label>X
          <select data-field="x" value={xField} onchange={(e) => pickX(e.currentTarget.value)}>
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
