import { useRef, useMemo } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
) {
  const timeoutRef = useRef<number | null>(null);
  const funcRef = useRef(fn);

  funcRef.current = fn;

  const debouncedFunction = useMemo(() => {
    const debounced: T & { cancel: () => void } = ((...args: Parameters<T>) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        funcRef.current(...args);
      }, delay);
    }) as T & { cancel: () => void };

    debounced.cancel = () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    return debounced;
  }, [delay]);

  return debouncedFunction;
}
