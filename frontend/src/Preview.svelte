<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Browser } from '@wailsio/runtime'
  import { createChartHydrator } from './lib/charts'
  import { createMermaidHydrator } from './lib/mermaid'
  import { createCodeHydrator } from './lib/codeHighlight'
  import { collectAnchors, createScrollSync, type Anchor } from './lib/scrollSync'
  import { cssTextAlign, type FigureAlignment } from './lib/figures'
  import { timed, timedAsync } from './lib/perf'
  import {
    sheetStyle,
    DEFAULT_PAPER_SIZE,
    DEFAULT_ORIENTATION,
    type PaperSize,
    type PageOrientation,
  } from './lib/paper'

  let {
    html,
    /** Hermes spelling ('left' | 'centre' | 'right'); mapped to CSS below. */
    figureAlign = 'centre',
    paperSize = DEFAULT_PAPER_SIZE,
    orientation = DEFAULT_ORIENTATION,
    // Injectable so tests can supply known anchors: jsdom has no layout engine
    // and would measure every element at zero. Mirrors createChartHydrator's
    // embed parameter, which exists for the same reason.
    collectAnchorsFn = collectAnchors,
  }: {
    html: string
    figureAlign?: FigureAlignment
    paperSize?: PaperSize
    orientation?: PageOrientation
    collectAnchorsFn?: (c: HTMLElement) => Anchor[]
  } = $props()

  let container: HTMLElement
  // Two refs, deliberately. `container` is the scroller: it owns scrollTop,
  // the ResizeObserver, and the anchor measurements. `sheet` is the paper:
  // it owns the rendered document. collectAnchors measures rects against the
  // container it is given PLUS that container's scrollTop, so handing it the
  // sheet — which never scrolls — would offset every anchor by the sheet's
  // top margin with nothing to correct it.
  let sheet: HTMLElement
  const hydrator = createChartHydrator()
  const mermaidHydrator = createMermaidHydrator()
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
    // `hermes:preview-dom` covers only the replacement: parsing the HTML and
    // building the new subtree. WebKit defers style and layout, so in Web
    // Inspector the cost of laying it out is the Layout record that follows
    // this measure, not part of it.
    timed('preview-dom', () => {
      sheet.innerHTML = html
    })
    // Anchor positions are invalid the moment the content changes, and again
    // once charts finish rendering — they change their own height after the
    // pass that created them.
    sync.invalidate()
    // The hydrators are measured to settlement, so `hermes:hydrate-*` spans
    // the async work (dynamic imports, Vega embeds) and not just the pass
    // that queued it.
    void timedAsync('hydrate-charts', hydrator.hydrate(sheet)).then(() => sync.invalidate())
    // Same reason the chart hydrator invalidates: a diagram changes its own
    // height after the pass that placed it, so anchors measured before it
    // rendered are wrong.
    void timedAsync('hydrate-mermaid', mermaidHydrator.hydrate(sheet)).then(() => sync.invalidate())
    // Every failure inside the hydrator already degrades to plain text; this
    // is a backstop against an unhandled rejection reaching the webview, not
    // the primary defence.
    void timedAsync('hydrate-code', codeHydrator.hydrate(sheet)).catch(() => {})
  })

  // Paper size and orientation change the sheet's width AND its padding, so
  // every block in the document reflows and every cached anchor `top` is
  // stale — but the pane's own box is unchanged, so the ResizeObserver below
  // never fires and createScrollSync goes on scrolling to the old offsets.
  // Sync scrolling would then land in the wrong place until the next
  // keystroke happened to invalidate the cache. An $effect rather than a
  // second ResizeObserver on the sheet: this component already invalidates
  // from an $effect when `html` changes, it is the same fact (the rendered
  // document moved) reported from the same place, and unlike an observer it
  // works under jsdom, so the guarded observer below stays the only piece of
  // this file a test cannot reach.
  $effect(() => {
    // Referenced rather than used: an $effect tracks exactly what it reads,
    // and this one is here for the reflow these two cause, not their values.
    void paperSize
    void orientation
    sync.invalidate()
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
    if (!href) return
    if (/^https?:\/\//i.test(href)) {
      void Browser.OpenURL(href)
      return
    }
    // A fragment link — a ToC entry, or a hand-written [text](#slug) — moves
    // this pane to its target. scrollTop arithmetic rather than
    // scrollIntoView, so the measurement matches collectAnchors' coordinate
    // space (and jsdom, where these tests run, has no scrollIntoView).
    // Matched by property, not by selector: a slug can contain characters a
    // selector would need escaped, and CSS.escape does not exist under jsdom.
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1))
      const target = [...sheet.querySelectorAll<HTMLElement>('[id]')].find((el) => el.id === id)
      if (!target) return
      container.scrollTop =
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop
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
>
  <div
    class="sheet"
    bind:this={sheet}
    style={sheetStyle(paperSize, orientation)}
  ></div>
</div>
