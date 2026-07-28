<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Browser } from '@wailsio/runtime'
  import { createChartHydrator } from './lib/charts'

  let { html }: { html: string } = $props()

  let container: HTMLElement
  const hydrator = createChartHydrator()

  $effect(() => {
    container.innerHTML = html
    void hydrator.hydrate(container)
  })

  onDestroy(() => hydrator.destroy())

  function onPreviewClick(e: MouseEvent) {
    const anchor = (e.target as Element).closest('a')
    if (!anchor) return
    e.preventDefault()
    const href = anchor.getAttribute('href')
    if (href && /^https?:\/\//i.test(href)) {
      void Browser.OpenURL(href)
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -- link delegation only, not a keyboard-interactive control -->
<!-- svelte-ignore a11y_no_static_element_interactions -- rendered content is read-only markdown output -->
<div class="preview-pane" bind:this={container} onclick={onPreviewClick}></div>
