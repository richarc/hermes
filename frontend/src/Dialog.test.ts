// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { createRawSnippet } from 'svelte'
import Dialog from './Dialog.svelte'

const body = createRawSnippet(() => ({ render: () => '<p>Body text</p>' }))

function mountDialog(open: boolean, onclose = vi.fn()) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(Dialog, {
    target,
    props: { open, label: 'Test dialog', onclose, children: body },
  })
  flushSync()
  return {
    target,
    onclose,
    el: target.querySelector('dialog')!,
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

describe('Dialog', () => {
  it('mounts without throwing where showModal is absent', () => {
    // jsdom 30 implements <dialog> as an element but not showModal/close. An
    // unguarded call throws and takes out every suite that mounts a dialog,
    // so this is the test that protects ChartBuilder.test.ts and App.test.ts.
    expect(typeof (document.createElement('dialog') as HTMLDialogElement).showModal).toBe(
      'undefined',
    )
    const d = mountDialog(true)
    expect(d.el.open).toBe(true)
    d.cleanup()
  })

  it('renders its content', () => {
    const d = mountDialog(true)
    expect(d.el.textContent).toContain('Body text')
    d.cleanup()
  })

  it('is closed when open is false', () => {
    const d = mountDialog(false)
    expect(d.el.open).toBe(false)
    d.cleanup()
  })

  it('carries its accessible name', () => {
    const d = mountDialog(true)
    expect(d.el.getAttribute('aria-label')).toBe('Test dialog')
    d.cleanup()
  })

  it('asks the parent to close on Esc rather than closing itself', () => {
    // The parent owns `open`, so the dialog reports the intent instead of
    // acting on it — otherwise the element and the prop drift apart.
    // `d.el.open` can't tell us this in jsdom: with no close() implementation
    // the element has no way to close itself either way, so that assertion
    // alone can't fail. dispatchEvent's return value is what actually proves
    // preventDefault() ran: it's `false` for a cancelable event only when
    // some handler called preventDefault().
    const d = mountDialog(true)
    const notCancelled = d.el.dispatchEvent(new Event('cancel', { cancelable: true }))
    flushSync()
    expect(notCancelled).toBe(false)
    expect(d.onclose).toHaveBeenCalledTimes(1)
    d.cleanup()
  })

  it('does not double-fire onclose when a constant-open dialog unmounts', () => {
    // ChartBuilder passes a literal `open` — always true, never toggled to
    // false — so its Cancel button calls the shared handler directly
    // (bypassing the dialog entirely), and separately, chartOpen going false
    // unmounts the component. In a real browser the teardown effect's
    // close() call fires a native `close` event synchronously; jsdom does
    // not implement close() at all, so the bug this guards against (that
    // close event reaching onNativeClose and calling onclose() a second
    // time) is invisible without stubbing browser-like close()/showModal()
    // semantics onto this one element. Stubbed on the instance, not the
    // prototype, so the other tests keep exercising the real jsdom absence.
    const onclose = vi.fn()
    const d = mountDialog(true, onclose)
    d.el.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
    d.el.close = function (this: HTMLDialogElement) {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }

    onclose() // Cancel's own handler, invoked directly — not through the dialog
    d.cleanup() // unmount: the teardown effect calls close() on the still-open element

    expect(onclose).toHaveBeenCalledTimes(1)
  })
})
