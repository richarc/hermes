import { describe, it, expect, vi } from 'vitest'
import { createKatexCache } from './katexCache'

function fakeKatex() {
  return {
    renderToString: vi.fn((tex: string, opts?: { displayMode?: boolean }) =>
      `<${opts?.displayMode ? 'div' : 'span'}>${tex}</${opts?.displayMode ? 'div' : 'span'}>`,
    ),
  }
}

describe('createKatexCache', () => {
  it('renders a formula once and serves repeats from the cache', () => {
    const k = fakeKatex()
    const c = createKatexCache(k)
    const a = c.renderToString('x^2', { displayMode: false })
    const b = c.renderToString('x^2', { displayMode: false })
    expect(b).toBe(a)
    expect(k.renderToString).toHaveBeenCalledTimes(1)
  })

  it('keys on display mode as well as source', () => {
    const k = fakeKatex()
    const c = createKatexCache(k)
    expect(c.renderToString('x', { displayMode: false })).toBe('<span>x</span>')
    expect(c.renderToString('x', { displayMode: true })).toBe('<div>x</div>')
    expect(k.renderToString).toHaveBeenCalledTimes(2)
  })

  it('passes the options through untouched on a miss', () => {
    const k = fakeKatex()
    const c = createKatexCache(k)
    const opts = { displayMode: true, throwOnError: false, errorColor: '#cc0000' }
    c.renderToString('y', opts)
    expect(k.renderToString).toHaveBeenCalledWith('y', opts)
  })

  it('evicts the least recently used entry past the limit, and a hit counts as use', () => {
    const k = fakeKatex()
    const c = createKatexCache(k, { max: 2 })
    c.renderToString('a')
    c.renderToString('b')
    c.renderToString('a') // refresh a: b is now the oldest
    c.renderToString('c') // evicts b
    expect(k.renderToString).toHaveBeenCalledTimes(3)
    c.renderToString('a')
    expect(k.renderToString).toHaveBeenCalledTimes(3)
    c.renderToString('b')
    expect(k.renderToString).toHaveBeenCalledTimes(4)
    expect(c.size).toBe(2)
  })

  it('does not cache a throw, so the plugin sees the error every time', () => {
    const k = { renderToString: vi.fn(() => { throw new Error('bad tex') }) }
    const c = createKatexCache(k)
    expect(() => c.renderToString('\\bad')).toThrow('bad tex')
    expect(() => c.renderToString('\\bad')).toThrow('bad tex')
    expect(k.renderToString).toHaveBeenCalledTimes(2)
    expect(c.size).toBe(0)
  })
})
