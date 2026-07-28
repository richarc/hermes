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
})
