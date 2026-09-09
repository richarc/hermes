/**
 * The demo-mode player: runs a parsed script (demo.go's DemoStep list)
 * against an `actions` object App.svelte supplies from functions it already
 * has. Pure over its two dependencies — the actions and a sleep — so it is
 * tested with fakes and a clock that never waits.
 *
 * It stops at the first step that fails and says which one, so a broken
 * script does not carry on producing a recording of the wrong thing. A
 * recording left running by a failure, or by a script that ends without
 * `stop`, is stopped, so the file on disk is always closed.
 */
export interface DemoStep {
  verb: string
  arg: string
  body: string
}

export interface DemoActions {
  open(path: string): Promise<void>
  goto(line: number): void
  typeChar(char: string): void
  menu(name: string): void
  chart(spec: string): void
  table(source: string): void
  /** Resolves once the window is full screen, not when the transition starts. */
  fullscreen(): Promise<void>
  record(path: string): Promise<void>
  stop(): Promise<void>
  quit(): Promise<void>
}

export type DemoResult =
  | { ok: true }
  | { ok: false; step: number; verb: string; message: string }

export type Sleep = (ms: number) => Promise<void>

export async function runDemo(
  steps: DemoStep[],
  actions: DemoActions,
  sleep: Sleep,
): Promise<DemoResult> {
  let recording = false
  for (let i = 0; i < steps.length; i++) {
    const { verb, arg, body } = steps[i]
    try {
      switch (verb) {
        case 'open':
          await actions.open(arg)
          break
        case 'goto':
          actions.goto(Number(arg))
          break
        case 'pause':
          await sleep(Number(arg))
          break
        case 'type': {
          const cadence = Number(arg)
          for (const char of body) {
            actions.typeChar(char)
            await sleep(cadence)
          }
          break
        }
        case 'menu':
          actions.menu(arg)
          break
        case 'chart':
          actions.chart(body)
          break
        case 'table':
          actions.table(body)
          break
        case 'fullscreen':
          await actions.fullscreen()
          break
        case 'record':
          await actions.record(arg)
          recording = true
          break
        case 'stop':
          await actions.stop()
          recording = false
          break
        case 'quit':
          if (recording) await actions.stop()
          await actions.quit()
          return { ok: true }
        default:
          throw new Error(`unknown verb ${JSON.stringify(verb)}`)
      }
    } catch (err) {
      if (recording) {
        // Best effort: the step's own error is the one to report.
        await actions.stop().catch(() => {})
      }
      return { ok: false, step: i + 1, verb, message: (err as Error).message ?? String(err) }
    }
  }
  if (recording) await actions.stop()
  return { ok: true }
}
