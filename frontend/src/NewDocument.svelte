<script lang="ts">
  import Dialog from './Dialog.svelte'
  import { STYLE_IDS } from './lib/citations'

  interface Props {
    open: boolean
    onclose: () => void
    /** The author pressed Create…; the parent goes on to the save panel. */
    oncreate: (withBibliography: boolean, csl: string) => void
  }

  const { open, onclose, oncreate }: Props = $props()

  // Ticked by default: the flow exists for papers, and a scratch document
  // costs one click to opt out of. The style only matters when it is ticked.
  let withBibliography = $state(true)
  let csl = $state('apa')

  // Reset for the next opening, so a choice made and then cancelled does not
  // silently carry into a later document.
  $effect(() => {
    if (open) {
      withBibliography = true
      csl = 'apa'
    }
  })
</script>

<Dialog {open} label="New document" {onclose}>
  <h2>New document</h2>
  <label class="check-row">
    <input type="checkbox" bind:checked={withBibliography} />
    Include a bibliography
  </label>
  <p class="hint">
    Creates a <code>.bib</code> file beside the document and points the
    document at it, so citations work from the first line.
  </p>
  {#if withBibliography}
    <label class="style-row"
      >Citation style
      <select bind:value={csl}>
        {#each STYLE_IDS as id (id)}
          <option value={id}>{id}</option>
        {/each}
      </select>
    </label>
  {/if}
  {#snippet footer()}
    <button onclick={onclose}>Cancel</button>
    <button class="primary" onclick={() => oncreate(withBibliography, csl)}>Create…</button>
  {/snippet}
</Dialog>

<style>
  h2 {
    margin: 0 0 0.75em;
    font-size: 1.1em;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }
  .hint {
    margin: 0.35em 0 0.9em 1.75em;
    font-size: 0.9em;
    color: var(--text-muted);
  }
  .style-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1em;
  }
</style>
