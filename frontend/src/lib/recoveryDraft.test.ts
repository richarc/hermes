import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDraftKeeper, DRAFT_DEBOUNCE_MS, type DraftSink } from './recoveryDraft'

function sink() {
  return {
    write: vi.fn(async (_p: string, _c: string) => {}),
    discard: vi.fn(async (_p: string) => {}),
  } satisfies DraftSink
}

describe('createDraftKeeper', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('exports a two-second default', () => {
    expect(DRAFT_DEBOUNCE_MS).toBe(2000)
  })

  it('writes once after the wait, with the latest content', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    k.update('/p.md', 'ab', true, true)
    vi.advanceTimersByTime(99)
    expect(s.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await k.settle()
    expect(s.write).toHaveBeenCalledExactlyOnceWith('/p.md', 'ab')
  })

  it('never writes a clean document', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', false, true)
    vi.advanceTimersByTime(1000)
    await k.settle()
    expect(s.write).not.toHaveBeenCalled()
    expect(s.discard).not.toHaveBeenCalled()
  })

  it('never writes while the setting is off, and drops a write already pending', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    k.update('/p.md', 'ab', true, false)
    vi.advanceTimersByTime(1000)
    await k.settle()
    expect(s.write).not.toHaveBeenCalled()
  })

  it('cancels the pending write and discards when the document goes clean', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    vi.advanceTimersByTime(50)
    k.update('/p.md', 'a', false, true) // saved
    vi.advanceTimersByTime(1000)
    await k.settle()
    expect(s.write).not.toHaveBeenCalled()
    expect(s.discard).toHaveBeenCalledExactlyOnceWith('/p.md')
  })

  it('discards on the clean transition even when the setting is off', async () => {
    // A draft written before the setting was switched off must still go
    // when the document is saved.
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, false)
    k.update('/p.md', 'a', false, false)
    await k.settle()
    expect(s.discard).toHaveBeenCalledExactlyOnceWith('/p.md')
  })

  it('discards only on a dirty-to-clean transition, not on every clean update', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', '', false, true)
    k.update('/p.md', '', false, true)
    await k.settle()
    expect(s.discard).not.toHaveBeenCalled()
  })

  it('queues the discard behind a write still in flight', async () => {
    const s = sink()
    let finishWrite!: () => void
    s.write.mockImplementationOnce(() => new Promise<void>((r) => (finishWrite = r)))

    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    vi.advanceTimersByTime(100) // the debounce fires; the write is queued
    k.update('/p.md', 'a', false, true) // saved while it is in flight
    // The queue runs its callbacks on microtasks: let the write start.
    await Promise.resolve()
    await Promise.resolve()
    expect(s.write).toHaveBeenCalledOnce()
    expect(s.discard).not.toHaveBeenCalled()
    finishWrite()
    await k.settle()
    expect(s.discard).toHaveBeenCalledExactlyOnceWith('/p.md')
  })

  it('reset drops the pending write and forgets the dirty state', async () => {
    const s = sink()
    const k = createDraftKeeper(s, 100)
    k.update('/old.md', 'a', true, true)
    k.reset()
    k.update('/new.md', 'fresh', false, true)
    vi.advanceTimersByTime(1000)
    await k.settle()
    expect(s.write).not.toHaveBeenCalled()
    expect(s.discard).not.toHaveBeenCalled()
  })

  it('a rejected sink call does not wedge the queue', async () => {
    const s = sink()
    s.write.mockRejectedValueOnce(new Error('disk full'))
    const k = createDraftKeeper(s, 100)
    k.update('/p.md', 'a', true, true)
    vi.advanceTimersByTime(100)
    await k.settle()
    k.update('/p.md', 'a', false, true)
    await k.settle()
    expect(s.discard).toHaveBeenCalledExactlyOnceWith('/p.md')
  })
})
