import { describe, it, expect, beforeEach } from 'vitest'
import { timed, timedAsync, PERF_PREFIX } from './perf'

const measures = (name: string) => performance.getEntriesByName(`${PERF_PREFIX}${name}`, 'measure')

describe('timed', () => {
  beforeEach(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })

  it('returns the function result and records one measure under the prefixed name', () => {
    expect(timed('render', () => 42)).toBe(42)
    expect(measures('render')).toHaveLength(1)
    expect(measures('render')[0].duration).toBeGreaterThanOrEqual(0)
  })

  it('records the measure even when the function throws, and rethrows', () => {
    expect(() =>
      timed('render', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(measures('render')).toHaveLength(1)
  })

  it('leaves no start mark behind, so the buffer holds only measures', () => {
    timed('render', () => undefined)
    expect(performance.getEntriesByType('mark')).toHaveLength(0)
  })

  it('records one measure per call', () => {
    timed('render', () => undefined)
    timed('render', () => undefined)
    expect(measures('render')).toHaveLength(2)
  })
})

describe('timedAsync', () => {
  beforeEach(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })

  it('resolves to the promise value and measures until settlement', async () => {
    await expect(timedAsync('charts', Promise.resolve('ok'))).resolves.toBe('ok')
    expect(measures('charts')).toHaveLength(1)
    expect(performance.getEntriesByType('mark')).toHaveLength(0)
  })

  it('measures a rejection too, and passes it on', async () => {
    await expect(timedAsync('charts', Promise.reject(new Error('nope')))).rejects.toThrow('nope')
    expect(measures('charts')).toHaveLength(1)
  })
})
