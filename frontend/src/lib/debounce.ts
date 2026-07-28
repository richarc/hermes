export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
