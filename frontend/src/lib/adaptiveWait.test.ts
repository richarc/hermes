import { describe, it, expect } from 'vitest'
import { createAdaptiveWait } from './adaptiveWait'

const opts = { initial: 100, min: 60, max: 300, factor: 2 }

describe('createAdaptiveWait', () => {
  it('starts at the initial wait before anything is measured', () => {
    expect(createAdaptiveWait(opts).wait()).toBe(100)
  })

  it('waits a multiple of the last measured cost', () => {
    const w = createAdaptiveWait(opts)
    w.record(50)
    expect(w.wait()).toBe(100)
    w.record(75)
    expect(w.wait()).toBe(150)
  })

  it('never goes below the floor, so a cheap document is not rendered mid-keystroke', () => {
    const w = createAdaptiveWait(opts)
    w.record(4)
    expect(w.wait()).toBe(60)
    w.record(0)
    expect(w.wait()).toBe(60)
  })

  it('never goes above the ceiling, so a huge document still updates', () => {
    const w = createAdaptiveWait(opts)
    w.record(5000)
    expect(w.wait()).toBe(300)
  })

  it('ignores a measurement that is not a finite number', () => {
    const w = createAdaptiveWait(opts)
    w.record(50)
    w.record(NaN)
    expect(w.wait()).toBe(100)
  })
})
