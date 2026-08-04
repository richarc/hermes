export interface Debounced<Args extends unknown[]> {
  (...args: Args): void
  /** Drops a pending call, for when the caller has superseded it. */
  cancel(): void
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: Args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  debounced.cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  return debounced
}
