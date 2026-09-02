// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import Editor from './Editor.svelte'

describe('spell checking prop', () => {
  it('turns off when the prop is false, and back on', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = $state({ spellcheck: false, onchange: (_t: string) => {} })
    const cmp = mount(Editor, { target, props })
    flushSync()
    const content = () => target.querySelector('.cm-content')!
    expect(content().getAttribute('spellcheck')).toBe('false')
    props.spellcheck = true
    flushSync()
    await vi.waitFor(() => expect(content().getAttribute('spellcheck')).toBe('true'))
    props.spellcheck = false
    flushSync()
    await vi.waitFor(() => expect(content().getAttribute('spellcheck')).toBe('false'))
    unmount(cmp)
    target.remove()
  })
})
