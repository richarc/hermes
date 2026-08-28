<script lang="ts">
  import type { OutlineEntry } from './lib/outline'

  interface Props {
    entries: OutlineEntry[]
    onjump: (line: number) => void
    /** The ‹ arrow: retract the panel. */
    onhide: () => void
  }

  const { entries, onjump, onhide }: Props = $props()
</script>

<nav class="outline" aria-label="Document outline">
  <div class="outline-header">
    <span>Outline</span>
    <button class="outline-arrow" onclick={onhide} title="Hide outline (⌘⌥O)" aria-label="Hide outline">‹</button>
  </div>
  {#if entries.length === 0}
    <p class="outline-empty">No headings yet</p>
  {:else}
    <ul>
      {#each entries as e, i (i)}
        <li style="padding-left: {12 + (e.level - 1) * 12}px">
          <button class="link-button outline-entry" onclick={() => onjump(e.line)} title={`Line ${e.line}`}>
            {e.text || '(untitled)'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>
