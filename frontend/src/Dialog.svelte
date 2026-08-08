<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    /** Accessible name; the dialogs here have no visible title element. */
    label: string
    /** The dialog asks to close; the parent owns `open` and decides. */
    onclose: () => void
    /** Extra classes, for a call site that needs its own sizing. */
    class?: string
    /** Overrides the element's implicit `dialog` role; `alertdialog` for a
        destructive confirm, which screen readers announce differently. */
    role?: string
    children: Snippet
    footer?: Snippet
  }

  const { open, label, onclose, class: extra = '', role, children, footer }: Props = $props()

  let el: HTMLDialogElement | undefined = $state()

  // True while the component is closing the element itself. `open` cannot
  // carry this: ChartBuilder passes a constant `true`, so it never catches up
  // and every self-initiated close would echo back through onNativeClose as
  // though the user had pressed Esc.
  let selfClosing = false

  // jsdom 30 implements <dialog> as an element but leaves showModal and close
  // undefined, so calling one throws and takes out every test that mounts a
  // dialog. Reflecting the `open` attribute is what jsdom does support, and is
  // enough for the component to render there. Same shape, and the same
  // reasoning, as Preview.svelte's `typeof ResizeObserver === 'undefined'`
  // guard: load-bearing for tests, not defensive.
  //
  // What is lost under the fallback is real: the focus trap, Esc, inertness
  // and top-layer rendering are browser behaviours, so they are manual checks
  // rather than assertions.
  $effect(() => {
    const d = el
    if (!d) return
    if (open) {
      if (typeof d.showModal === 'function') {
        if (!d.open) d.showModal()
      } else {
        d.open = true
      }
    } else if (typeof d.close === 'function') {
      if (d.open) {
        selfClosing = true
        d.close()
      }
    } else {
      d.open = false
    }
  })

  // Unmounting removes the element from the top layer, but skips the focus
  // restoration close() performs — ChartBuilder is unmounted rather than
  // closed, so without this the caret does not return to the editor.
  $effect(() => () => {
    const d = el
    if (d && typeof d.close === 'function' && d.open) {
      selfClosing = true
      d.close()
    }
  })

  // Esc fires `cancel`. Prevented, so the element does not close behind the
  // parent's back and leave `open` describing something untrue.
  function onCancel(event: Event) {
    event.preventDefault()
    onclose()
  }

  // The element closed without the prop asking. Tell the parent so `open` can
  // catch up. Guarded against our own close() calls above via selfClosing,
  // not `open`: ChartBuilder passes a constant `open={true}` that never
  // transitions, so `open` alone can't tell a self-initiated close from an
  // external one — every teardown-triggered close would otherwise echo back
  // through here as though the user had pressed Esc.
  function onNativeClose() {
    if (selfClosing) {
      selfClosing = false
      return
    }
    if (open) onclose()
  }
</script>

<dialog
  bind:this={el}
  class={extra || undefined}
  aria-label={label}
  role={role}
  oncancel={onCancel}
  onclose={onNativeClose}
>
  <div class="dialog-body">{@render children()}</div>
  {#if footer}
    <div class="modal-buttons">{@render footer()}</div>
  {/if}
</dialog>
