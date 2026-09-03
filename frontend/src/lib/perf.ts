/**
 * User Timing marks for profiling the render pipeline in Safari's Web
 * Inspector (Develop → <app> → Timelines). Every measure is named
 * `hermes:<name>`, so the Timeline's JavaScript & Events track lists them
 * together and `performance.getEntriesByName('hermes:render')` reads them
 * back from the console.
 *
 * The start mark is cleared once the measure exists — the measure carries
 * the duration, and Web Inspector records User Timing entries as they are
 * made, so a cleared mark costs nothing it can see. Measures are left in
 * the buffer: a few hundred bytes per keystroke pause, and they are what
 * the console reads.
 */
export const PERF_PREFIX = 'hermes:'

// Counter so overlapping measures of one name (two chart hydrations in
// flight) each get their own start mark rather than sharing one.
let seq = 0

function start(name: string): string {
  const mark = `${PERF_PREFIX}${name}:start:${seq++}`
  performance.mark(mark)
  return mark
}

function finish(name: string, mark: string): void {
  performance.measure(`${PERF_PREFIX}${name}`, mark)
  performance.clearMarks(mark)
}

/** Run `fn` and record how long it took as the measure `hermes:<name>`. */
export function timed<T>(name: string, fn: () => T): T {
  const mark = start(name)
  try {
    return fn()
  } finally {
    finish(name, mark)
  }
}

/** Record how long `promise` takes to settle as the measure `hermes:<name>`. */
export function timedAsync<T>(name: string, promise: Promise<T>): Promise<T> {
  const mark = start(name)
  return promise.finally(() => finish(name, mark))
}
