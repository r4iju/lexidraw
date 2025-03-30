"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Creates a debounced version of a function.
 *
 * This implementation defers updating ref values until after render so that
 * we don’t access ref.current during render.
 */
export function useDebounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
) {
  // These refs hold mutable values.
  const timeoutRef = useRef<number | null>(null);
  const funcRef = useRef(fn);

  // Hold the debounced function in state.
  const [debouncedFn, setDebouncedFn] = useState<T & { cancel: () => void }>(
    () => {
      // Initial dummy function; it shouldn’t be called before effects run.
      const noop = ((..._args: any[]) => {}) as T & { cancel: () => void };
      noop.cancel = () => {};
      return noop;
    },
  );

  // Update the function ref after render.
  useEffect(() => {
    funcRef.current = fn;
  }, [fn]);

  // Create (or recreate) the debounced function when the delay changes.
  useEffect(() => {
    const newDebounced = ((...args: Parameters<T>) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        // This is safe because it runs after render.
        funcRef.current(...args);
      }, delay);
    }) as T & { cancel: () => void };

    newDebounced.cancel = () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    setDebouncedFn(() => newDebounced);
  }, [delay]);

  return debouncedFn;
}
