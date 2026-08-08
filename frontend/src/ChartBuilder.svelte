<script lang="ts">
  import { untrack } from 'svelte'
  import { parseDelimited, tableFromRows, toDelimited, type DataTable, type FieldType } from './lib/dataTable'
  import { buildSpec, MARKS, AGGREGATES, type Mark, type Aggregate, type BuilderState } from './lib/chartSpec'
  import { embedChart, type ChartView } from './lib/charts'
  import { captionFromTitle } from './lib/figures'
  import { DocumentService } from '../bindings/hermes'
  import Dialog from './Dialog.svelte'

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
    caption: string
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
  // table is seeded from the spec and the paste box is seeded from the table
  // (see `pasted` below). The encoded columns (x/y/colour) already carry an
  // authoritative type read out of the spec — trust those rather than
  // re-guessing, since a guess from row values alone cannot tell a date
  // column from a nominal one reliably.
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
      caption: captionFromTitle(initial?.extras.title),
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

  /**
   * Serializes a seeded table for the paste box, but only if the result would
   * actually read back as the same table. `toDelimited` only promises to
   * reproduce text the box itself could have produced — a hand-authored spec
   * can hold a column name `parseDelimited` would never write into a header
   * (e.g. one containing whitespace with no comma or tab to sniff a delimiter
   * from, or an empty name). Serializing that anyway would open the modal
   * looking fine and then unmount the encode section on the very first
   * keystroke, with a parse error the user did not cause and cannot fix
   * without renaming a column they never touched. Falling back to '' here is
   * exactly today's pre-fill-less behaviour for that case.
   */
  function seedPasteText(t: DataTable | null): string {
    if (!t) return ''
    const text = toDelimited(t)
    return parseDelimited(text).ok ? text : ''
  }

  // Reopening a chart seeds the box with its own data, so it can be edited
  // rather than only replaced. A table with no columns serializes to '',
  // which is also what an unseeded builder wants — seedPasteText's guard
  // covers both that case and the unparseable-header-name case above.
  let pasted = $state(seedPasteText(seed.table))
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
      // A fresh paste — or an in-progress edit of the header row — can
      // rename or drop a column an axis selection names. This used to clear
      // the selection on the spot, but load() runs on every keystroke:
      // retyping a header character by character renames the column away
      // and back on every intermediate keystroke, and clearing threw the
      // user's selection (and any declared type override) away with nothing
      // to restore it — re-picking the column from the dropdown re-infers
      // its type from scratch. Leave the selection alone and let `ready`
      // gate on the column actually existing instead: Insert/Update disables
      // and the preview blanks while the reference is dangling, and both
      // recover the moment the text is valid again, without discarding
      // anything the user chose.
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
  let caption = $state(seed.caption)

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

  // load() no longer clears a selection whose column has vanished (see the
  // comment there), so readiness has to check that a selected column still
  // exists in the current table itself — otherwise Insert/Update would stay
  // enabled for a spec that encodes a column absent from the data. `count`
  // aggregate is exempt on y because canonicalise() drops y.field from the
  // committed spec whenever it applies, so a dangling yField there is inert,
  // not a hazard. colourField is optional throughout: '' is always fine, a
  // non-empty value must still resolve.
  const hasColumn = (name: string) => columns.some((c) => c.name === name)
  const ready = $derived(
    table !== null &&
      xField !== '' &&
      hasColumn(xField) &&
      (effectiveAggregate === 'count' || (yField !== '' && hasColumn(yField))) &&
      (colourField === '' || hasColumn(colourField)),
  )

  // The caption lives in the spec's own `title` — Vega-Lite's native home for
  // it, so the block stays portable and Pandoc keeps the caption. renderer.ts
  // lifts it out and draws it below the chart.
  //
  // Only rewritten when the field actually changed: a title the box cannot
  // show as text (an object with styling, say) is inert metadata readSpec
  // preserved, and clearing it because the box looked empty would be silent
  // data loss.
  const extras = $derived.by(() => {
    const base = { ...(initial?.extras ?? {}) }
    const text = caption.trim()
    if (text === seed.caption) return base
    if (text === '') delete base.title
    else base.title = text
    return base
  })

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
          // Metadata the UI never shows — a description, a $schema line — that
          // readSpec preserved when this chart was opened, plus the caption
          // the field above owns. Carrying the rest through is what stops
          // reopening a chart from quietly stripping it.
          extras,
        }
      : null,
  )

  // The document draws the caption below the chart, so the preview must too —
  // otherwise the builder shows it inside the chart and the document shows it
  // underneath. No number is shown: numbering is a property of the document,
  // assigned by position, and the builder cannot know it.
  const previewSpec = $derived(
    builderState ? buildSpec({ ...builderState, extras: withoutTitle(extras) }) : '',
  )

  function withoutTitle(e: Record<string, unknown>): Record<string, unknown> {
    const rest = { ...e }
    delete rest.title
    return rest
  }

  let previewEl: HTMLDivElement | undefined = $state()
  let view: ChartView | null = null
  let generation = 0

  // Mirrors charts.ts: a newer pass invalidates an older one, so a slow embed
  // cannot overwrite a faster later one. Bumping generation on the early-out
  // path too means an embed already in flight when the table/selection is
  // cleared takes the stale branch on arrival and finalizes itself, instead
  // of resurrecting a view for a chart that is no longer showing.
  $effect(() => {
    const spec = previewSpec
    const el = previewEl
    if (spec === '' || !el) {
      generation++
      view?.finalize()
      view = null
      return
    }
    const gen = ++generation
    void embedChart(el, spec).then((v) => {
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

<Dialog open label="Chart builder" class="chart-builder" onclose={oncancel}>
  <h2>Chart</h2>

  <section class="data-step">
    <label for="chart-paste">Data</label>
    <textarea
      id="chart-paste"
      bind:this={pasteEl}
      rows={initial ? 12 : 6}
      placeholder="Paste a comma- or tab-separated table with a header row"
      value={pasted}
      oninput={onPaste}
    ></textarea>
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
      <label class="caption-row">Caption
        <input data-field="caption" bind:value={caption} />
      </label>

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
    {#if caption.trim()}
      <p class="chart-caption">{caption.trim()}</p>
    {/if}
  {/if}

  {#snippet footer()}
    <button onclick={oncancel}>Cancel</button>
    <button class="primary" disabled={!ready} onclick={commit}>
      {initial ? 'Update chart' : 'Insert chart'}
    </button>
  {/snippet}
</Dialog>
