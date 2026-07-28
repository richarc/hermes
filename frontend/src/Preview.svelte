<script lang="ts">
  import { hydrateCharts } from './lib/charts'

  let { html }: { html: string } = $props()

  let container: HTMLElement
  const chartCache = new Map<string, HTMLElement>()

  $effect(() => {
    container.innerHTML = html
    void hydrateCharts(container, chartCache)
  })
</script>

<div class="preview-pane" bind:this={container}></div>
