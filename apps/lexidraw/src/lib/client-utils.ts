"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A debounced function that won’t call `fn` until
 * `delay` ms have passed since its last invocation.
 * Returns an object with { run, cancel } so we avoid
 * mutating a function object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
) {
  // Keep track of latest fn in a ref to avoid stale closures
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  // Track timeout ID
  const timeoutRef = useRef<number | null>(null);

  // The “run” method calls the latest fn, debounced
  const run = (...args: Parameters<T>) => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      fnRef.current(...args);
    }, delay);
  };

  // The “cancel” method clears any pending timeout
  const cancel = () => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Return both methods in an object
  return { run, cancel };
}

export function useDebounceValue<T>(value: T, delay: number): [T] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return [debouncedValue];
}
