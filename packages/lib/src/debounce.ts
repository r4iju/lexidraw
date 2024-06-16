export function debounce<F extends (...args: unknown[]) => void>(
  fn: F,
  delay: number,
): (this: ThisParameterType<F>, ...args: Parameters<F>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (...args: Parameters<F>) {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delay);
  };
}