import { useEffect, useRef, useCallback } from "react";

// Saves incoming handler to the ref in order to avoid "useCallback hell"
export function useEventCallback<T>(
  handler?: (value: T) => void,
): (value: T) => void {
  const callbackRef = useRef(handler);

  // Update callbackRef.current with the latest handler whenever it changes.
  useEffect(() => {
    callbackRef.current = handler;
  }, [handler]);

  // Return a memoized (stable) function that calls the latest handler.
  // The function's identity is stable due to the empty dependency array.
  return useCallback((value: T) => {
    if (callbackRef.current) {
      callbackRef.current(value);
    }
  }, []);
}
