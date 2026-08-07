<script lang="ts">
  import { parseDelimited, type DataTable } from './lib/dataTable'
  import type { BuilderState } from './lib/chartSpec'
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
  // box starts empty and the table is seeded from the spec.
  if (initial) {
    const names = Object.keys(initial.rows[0] ?? {})
    table = {
      columns: names.map((name) => ({
        name,
        type: typeof initial.rows[0]?.[name] === 'number' ? 'quantitative' : 'nominal',
      })),
      rows: initial.rows,
    }
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

    <div class="modal-buttons">
      <button onclick={oncancel}>Cancel</button>
      <button disabled>Insert chart</button>
    </div>
  </div>
</div>
