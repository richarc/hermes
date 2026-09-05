export interface Debounced<Args extends unknown[]> {
  (...args: Args): void
  /** Drops a pending call, for when the caller has superseded it. */
  cancel(): void
}

/**
 * `wait` may be a function, consulted each time a call is scheduled, so the
 * delay can follow a measurement — see createAdaptiveWait. A pending call
 * that is superseded is rescheduled with the wait as it is *now*, not as it
 * was when the first keystroke landed.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number | (() => number),
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: Args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), typeof wait === 'function' ? wait() : wait)
  }
  debounced.cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  return debounced
}
