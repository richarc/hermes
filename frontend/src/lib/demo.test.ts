import { describe, it, expect, vi } from 'vitest'
import { runDemo, type DemoActions, type DemoStep } from './demo'

function fakeActions(overrides: Partial<DemoActions> = {}) {
  const log: string[] = []
  const rec = (name: string) => (...args: unknown[]) => {
    log.push([name, ...args.map(String)].join(' '))
  }
  const actions: DemoActions = {
    open: vi.fn(async (p: string) => rec('open')(p)),
    goto: vi.fn((n: number) => rec('goto')(n)),
    typeChar: vi.fn((c: string) => rec('type')(JSON.stringify(c))),
    menu: vi.fn((name: string) => rec('menu')(name)),
    chart: vi.fn((spec: string) => rec('chart')(spec)),
    table: vi.fn((src: string) => rec('table')(src)),
    fullscreen: vi.fn(async () => rec('fullscreen')()),
    record: vi.fn(async (p: string) => rec('record')(p)),
    stop: vi.fn(async () => rec('stop')()),
    quit: vi.fn(async () => rec('quit')()),
    ...overrides,
  }
  return { actions, log }
}

/** A sleep that records its waits and resolves at once. */
function fakeSleep() {
  const waits: number[] = []
  const sleep = vi.fn(async (ms: number) => {
    waits.push(ms)
  })
  return { sleep, waits }
}

const step = (verb: string, arg = '', body = ''): DemoStep => ({ verb, arg, body })

describe('runDemo', () => {
  it('runs the steps in order and implies a stop at the end', async () => {
    const { actions, log } = fakeActions()
    const { sleep } = fakeSleep()
    const result = await runDemo(
      [step('open', '/d/a.md'), step('goto', '3'), step('menu', 'insert-chart'), step('record', '/d/o.mov')],
      actions,
      sleep,
    )
    expect(result).toEqual({ ok: true })
    expect(log).toEqual(['open /d/a.md', 'goto 3', 'menu insert-chart', 'record /d/o.mov', 'stop'])
  })

  it('awaits fullscreen before moving on, so record measures the finished window', async () => {
    const order: string[] = []
    let release!: () => void
    const { actions } = fakeActions({
      fullscreen: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = () => {
              order.push('fullscreen done')
              resolve()
            }
          }),
      ),
      record: vi.fn(async () => {
        order.push('record')
      }),
    })
    const run = runDemo([step('fullscreen'), step('record', '/d/o.mov')], actions, fakeSleep().sleep)
    await Promise.resolve()
    expect(order).toEqual([])
    release()
    await run
    expect(order).toEqual(['fullscreen done', 'record'])
  })

  it('does not stop at the end when nothing was recording', async () => {
    const { actions, log } = fakeActions()
    await runDemo([step('pause', '10')], actions, fakeSleep().sleep)
    expect(log).toEqual([])
  })

  it('types a body one character at a time at the cadence, line breaks included', async () => {
    const { actions, log } = fakeActions()
    const { sleep, waits } = fakeSleep()
    await runDemo([step('type', '45', 'ab\nc')], actions, sleep)
    expect(log).toEqual(['type "a"', 'type "b"', 'type "\\n"', 'type "c"'])
    expect(waits).toEqual([45, 45, 45, 45])
  })

  it('pauses for the given time', async () => {
    const { actions } = fakeActions()
    const { sleep, waits } = fakeSleep()
    await runDemo([step('pause', '1500')], actions, sleep)
    expect(waits).toEqual([1500])
  })

  it('hands chart and table bodies to their commits', async () => {
    const { actions, log } = fakeActions()
    await runDemo([step('chart', '', '{"a":1}'), step('table', '', '| a |')], actions, fakeSleep().sleep)
    expect(log).toEqual(['chart {"a":1}', 'table | a |'])
  })

  it('stops at the first failing step and names it', async () => {
    const { actions, log } = fakeActions({
      open: vi.fn(async () => {
        throw new Error('no such file')
      }),
    })
    const result = await runDemo(
      [step('pause', '1'), step('open', '/d/missing.md'), step('goto', '2')],
      actions,
      fakeSleep().sleep,
    )
    expect(result).toEqual({ ok: false, step: 2, verb: 'open', message: 'no such file' })
    expect(log).toEqual([])
    expect(actions.goto).not.toHaveBeenCalled()
  })

  it('stops a recording that was running when a later step fails', async () => {
    const { actions, log } = fakeActions({
      goto: vi.fn(() => {
        throw new Error('bad line')
      }),
    })
    await runDemo([step('record', '/d/o.mov'), step('goto', '0')], actions, fakeSleep().sleep)
    expect(log).toEqual(['record /d/o.mov', 'stop'])
  })

  it('explicit stop and quit call through, and quit ends the run', async () => {
    const { actions, log } = fakeActions()
    await runDemo([step('record', '/d/o.mov'), step('stop'), step('quit'), step('pause', '1')], actions, fakeSleep().sleep)
    expect(log).toEqual(['record /d/o.mov', 'stop', 'quit'])
  })

  it('rejects an unknown verb rather than skipping it', async () => {
    const { actions } = fakeActions()
    const result = await runDemo([step('dance')], actions, fakeSleep().sleep)
    expect(result.ok).toBe(false)
  })
})
