<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Browser } from '@wailsio/runtime'
  import { createChartHydrator } from './lib/charts'
  import { createCodeHydrator } from './lib/codeHighlight'
  import { collectAnchors, createScrollSync, type Anchor } from './lib/scrollSync'
  import { cssTextAlign, type FigureAlignment } from './lib/figures'

  let {
    html,
    /** Hermes spelling ('left' | 'centre' | 'right'); mapped to CSS below. */
    figureAlign = 'centre',
    // Injectable so tests can supply known anchors: jsdom has no layout engine
    // and would measure every element at zero. Mirrors createChartHydrator's
    // embed parameter, which exists for the same reason.
    collectAnchorsFn = collectAnchors,
  }: {
    html: string
    figureAlign?: FigureAlignment
    collectAnchorsFn?: (c: HTMLElement) => Anchor[]
  } = $props()

  let container: HTMLElement
  const hydrator = createChartHydrator()
  const codeHydrator = createCodeHydrator()

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
    void codeHydrator.hydrate(container)
  })

  onMount(() => {
    // A ResizeObserver on the container's own box subsumes a window resize
    // listener: it fires on an actual window resize (which resizes the
    // container too), on the pane divider being dragged or arrow-key-resized
    // (which changes .editor-pane's width and, via the flex row, reflows
    // .preview-pane to a new width with no window resize event at all), and
    // on late-settling content — async <img> loads and KaTeX web fonts —
    // that changes block heights after the render pass already measured them.
    //
    // jsdom (used by this component's tests) has no ResizeObserver at all, so
    // this guard is load-bearing for tests, not just defensive: without it,
    // mounting Preview under jsdom throws. It also means the observer's
    // firing can't be exercised by a test — verified by reading instead, per
    // the fix-wave notes.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => sync.invalidate())
    observer.observe(container)
    return () => observer.disconnect()
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
<div
  class="preview-pane"
  data-figure-align={cssTextAlign(figureAlign)}
  bind:this={container}
  onclick={onPreviewClick}
></div>
