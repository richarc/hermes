<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Browser } from '@wailsio/runtime'
  import { createChartHydrator } from './lib/charts'
  import { collectAnchors, createScrollSync, type Anchor } from './lib/scrollSync'

  let {
    html,
    // Injectable so tests can supply known anchors: jsdom has no layout engine
    // and would measure every element at zero. Mirrors createChartHydrator's
    // embed parameter, which exists for the same reason.
    collectAnchorsFn = collectAnchors,
  }: { html: string; collectAnchorsFn?: (c: HTMLElement) => Anchor[] } = $props()

  let container: HTMLElement
  const hydrator = createChartHydrator()

  const sync = createScrollSync({
    getAnchors: () => collectAnchorsFn(container),
    getScrollHeight: () => container.scrollHeight,
    setScrollTop: (y) => (container.scrollTop = y),
  })

  export function syncToLine(line: number, docLines: number): void {
    sync.sync(line, docLines)
  }

  $effect(() => {
    container.innerHTML = html
    // Anchor positions are invalid the moment the content changes, and again
    // once charts finish rendering — they change their own height after the
    // pass that created them.
    sync.invalidate()
    void hydrator.hydrate(container).then(() => sync.invalidate())
  })

  onMount(() => {
    const onResize = () => sync.invalidate()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
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
