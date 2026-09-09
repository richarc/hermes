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

  it('a maxWait bounds how long a stream of calls can hold the function off', () => {
    const fn = vi.fn()
    const d = debounce(fn, 60, 240)
    // Called every 35 ms, so the 60 ms wait is never reached on its own.
    for (let t = 0; t < 700; t += 35) {
      d(`t${t}`)
      vi.advanceTimersByTime(35)
    }
    // 700 ms of continuous calls: fires at 240 and 480 ms into the stream.
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, 't210')
    expect(fn).toHaveBeenNthCalledWith(2, 't455')
    vi.advanceTimersByTime(60)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenLastCalledWith('t665')
  })

  it('a maxWait is measured from the first call of a burst, not from an earlier one', () => {
    const fn = vi.fn()
    const d = debounce(fn, 60, 240)
    d('a')
    vi.advanceTimersByTime(60)
    expect(fn).toHaveBeenCalledExactlyOnceWith('a')
    vi.advanceTimersByTime(1000)
    // A new burst: its own 240 ms allowance, so a call at 30 ms is not
    // fired early because of the burst a second ago.
    d('b')
    vi.advanceTimersByTime(30)
    d('c')
    vi.advanceTimersByTime(30)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30)
    expect(fn).toHaveBeenLastCalledWith('c')
  })

  it('cancel also forgets the burst the maxWait was counting from', () => {
    const fn = vi.fn()
    const d = debounce(fn, 60, 240)
    // Seven calls 35 ms apart: none fires, and the burst is 20 ms short of
    // its maxWait when it is cancelled at 220 ms.
    for (let t = 0; t <= 210; t += 35) {
      d(`t${t}`)
      vi.advanceTimersByTime(t < 210 ? 35 : 10)
    }
    d.cancel()
    d('b')
    // Counted from a fresh burst, 'b' waits its full 60 ms, not the 20 ms
    // the cancelled burst had left.
    vi.advanceTimersByTime(30)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30)
    expect(fn).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('asks a function-valued maxWait each time, like wait', () => {
    const fn = vi.fn()
    let max = 100
    const d = debounce(fn, 60, () => max)
    d('a')
    vi.advanceTimersByTime(50)
    max = 80
    d('b')
    vi.advanceTimersByTime(30)
    expect(fn).toHaveBeenCalledExactlyOnceWith('b')
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
