/**
 * A debounce delay that follows the cost of the work it gates.
 *
 * The preview used to wait a fixed 250 ms after the last keystroke, chosen
 * when a render could cost that much. With the render at ~10 ms in the test
 * document the wait was the whole perceived latency. A fixed short wait is
 * the wrong fix, because a long, chart-heavy paper can still take 100 ms or
 * more, and a wait shorter than the render queues renders behind each other
 * while the user types. So: wait a multiple of what the last update cost,
 * clamped — a floor so a cheap document is not re-rendered between two
 * keystrokes of one word, a ceiling so a huge one still updates within a
 * beat of the user pausing.
 */
export interface AdaptiveWait {
  /** The delay to use for the next scheduled call, in ms. */
  wait(): number
  /** Feed back how long the gated work took, in ms. */
  record(costMs: number): void
}

export interface AdaptiveWaitOptions {
  /** Used until the first measurement arrives. */
  initial: number
  min: number
  max: number
  /** The wait is `factor` times the last cost, before clamping. */
  factor: number
}

export function createAdaptiveWait(opts: AdaptiveWaitOptions): AdaptiveWait {
  let current = opts.initial
  return {
    wait: () => current,
    record(costMs) {
      if (!Number.isFinite(costMs)) return
      current = Math.min(opts.max, Math.max(opts.min, costMs * opts.factor))
    },
  }
}
