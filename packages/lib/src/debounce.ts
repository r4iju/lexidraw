/**
 * Basically a copy of lodash.debounce and lodash.throttle
 */

export interface DebounceOptions {
  leading?: boolean;
  maxWait?: number;
  trailing?: boolean;
}

type AnyFn = (...args: unknown[]) => unknown;
type DebouncedFunc<T extends AnyFn> = {
  /**
   * The debounced function. Receives the same arguments as `func`.
   */
  (
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ): ReturnType<T> | undefined;

  /**
   * Cancels any pending invocations.
   */
  cancel(): void;

  /**
   * Immediately invokes the function if pending, and returns its result.
   */
  flush(): ReturnType<T> | undefined;
};

export interface ThrottleOptions {
  leading?: boolean;
  trailing?: boolean;
}

// -------------------------------------------------------------
// Debounce
// -------------------------------------------------------------
export function debounce<T extends AnyFn>(
  func: T,
  wait: number,
  options: DebounceOptions = {},
): DebouncedFunc<T> {
  // The “native” helpers from your snippet, preserved as is
  const nativeMin = Math.min;
  const nativeMax = Math.max;

  // Extract debounce options
  const leading = !!options.leading;
  let maxing = false;
  let maxWait = 0;
  const trailing = options.trailing !== undefined ? !!options.trailing : true;

  if (typeof func !== "function") {
    throw new TypeError("Expected a function");
  }

  if (typeof options === "object" && "maxWait" in options) {
    maxing = true;
    maxWait = nativeMax(Number(options.maxWait) || 0, wait);
  }

  // Internal state
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let lastCallTime: number | undefined;
  let lastInvokeTime = 0;
  let lastArgs: Parameters<T> | undefined;
  let lastThis: ThisParameterType<T> | undefined;
  let result: ReturnType<T> | undefined;

  // -------------------------------------------
  // Helpers
  // -------------------------------------------
  function invokeFunc(time: number) {
    const args = lastArgs as Parameters<T>;
    const thisArg = lastThis as ThisParameterType<T>;

    lastArgs = undefined;
    lastThis = undefined;
    lastInvokeTime = time;

    result = func.apply(thisArg, args);
    return result;
  }

  function leadingEdge(time: number) {
    // Reset the `maxWait` timer
    lastInvokeTime = time;
    // Start the timer for the trailing edge
    timerId = setTimeout(timerExpired, wait);

    return leading ? invokeFunc(time) : result;
  }

  function remainingWait(time: number) {
    const timeSinceLastCall = time - (lastCallTime ?? 0);
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeLeft = wait - timeSinceLastCall;
    return maxing
      ? nativeMin(timeLeft, maxWait - timeSinceLastInvoke)
      : timeLeft;
  }

  function shouldInvoke(time: number) {
    const timeSinceLastCall = time - (lastCallTime ?? 0);
    const timeSinceLastInvoke = time - lastInvokeTime;

    // If it's first call, or enough time has elapsed, or time is negative (system clock changed), or we've hit maxWait
    return (
      lastCallTime === undefined ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxing && timeSinceLastInvoke >= maxWait)
    );
  }

  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    // Restart the timer
    timerId = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time: number) {
    timerId = undefined;
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = undefined;
    lastThis = undefined;
    return result;
  }

  // -------------------------------------------
  // Main wrapped function
  // -------------------------------------------
  function debounced(this: ThisParameterType<T>, ...args: Parameters<T>) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        return leadingEdge(time);
      }
      if (maxing) {
        // Handle invocations in a tight loop
        timerId = setTimeout(timerExpired, wait);
        return invokeFunc(time);
      }
    }

    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }

  // -------------------------------------------
  // Add methods to the debounced function
  // -------------------------------------------
  debounced.cancel = function cancel() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = undefined;
    lastCallTime = undefined;
    lastThis = undefined;
    timerId = undefined;
  };

  debounced.flush = function flush() {
    if (timerId === undefined) {
      return result;
    }
    return trailingEdge(Date.now());
  };

  return debounced;
}

// -------------------------------------------------------------
// Throttle
// -------------------------------------------------------------
export function throttle<T extends AnyFn>(
  func: T,
  wait: number,
  options: ThrottleOptions = {},
): DebouncedFunc<T> {
  const leading = options.leading !== undefined ? !!options.leading : true;
  const trailing = options.trailing !== undefined ? !!options.trailing : true;

  if (typeof func !== "function") {
    throw new TypeError("Expected a function");
  }

  // Reuse debounce with maxWait = wait
  return debounce(func, wait, {
    leading,
    trailing,
    maxWait: wait,
  });
}
