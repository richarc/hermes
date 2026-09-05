import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once with the last arguments after the wait', () => {
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d('a'); d('b'); d('c')
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledExactlyOnceWith('c')
  })

  it('resets the timer on each call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d('a')
    vi.advanceTimersByTime(200)
    d('b')
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('cancel drops a pending call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d('a')
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('asks a function-valued wait each time a call is scheduled', () => {
    const fn = vi.fn()
    let wait = 100
    const d = debounce(fn, () => wait)
    d('a')
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledExactlyOnceWith('a')
    wait = 20
    d('b')
    vi.advanceTimersByTime(20)
    expect(fn).toHaveBeenLastCalledWith('b')
  })

  it('cancel on an idle debounce is harmless, and it still works afterwards', () => {
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d.cancel()
    d('a')
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledExactlyOnceWith('a')
  })
})
