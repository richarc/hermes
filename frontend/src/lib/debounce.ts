export interface Debounced<Args extends unknown[]> {
  (...args: Args): void
  /** Drops a pending call, for when the caller has superseded it. */
  cancel(): void
}

type Wait = number | (() => number)

const resolve = (w: Wait): number => (typeof w === 'function' ? w() : w)

/**
 * `wait` may be a function, consulted each time a call is scheduled, so the
 * delay can follow a measurement — see createAdaptiveWait. A pending call
 * that is superseded is rescheduled with the wait as it is *now*, not as it
 * was when the first keystroke landed.
 *
 * A plain trailing debounce never fires while calls keep arriving faster
 * than `wait`, so a stream of them starves the function for as long as it
 * lasts. `maxWait`, when given, bounds that: counted from the first call of
 * a burst, the function fires no later than `maxWait` after it, and the
 * burst is counted afresh from the next call. Like `wait` it may be a
 * function, consulted as each call is scheduled.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: Wait,
  maxWait?: Wait,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let burstStart: number | undefined
  const debounced = (...args: Args) => {
    clearTimeout(timer)
    let delay = resolve(wait)
    if (maxWait !== undefined) {
      const now = Date.now()
      burstStart ??= now
      delay = Math.min(delay, Math.max(0, burstStart + resolve(maxWait) - now))
    }
    timer = setTimeout(() => {
      burstStart = undefined
      fn(...args)
    }, delay)
  }
  debounced.cancel = () => {
    clearTimeout(timer)
    timer = undefined
    burstStart = undefined
  }
  return debounced
}
