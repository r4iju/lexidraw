/* eslint-disable @typescript-eslint/no-explicit-any */

type DebouncedFunction<T extends (...args: any[]) => any> = {
  (...args: Parameters<T>): Promise<ReturnType<T>>;
  cancel: () => void;
};

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): DebouncedFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let currentPromise: Promise<ReturnType<T>> | undefined;
  let promiseResolve: ((value: ReturnType<T>) => void) | undefined;

  const debouncedFn = function (
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ): Promise<ReturnType<T>> {
    // Cancel any pending execution
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Create new promise if none exists or previous was resolved
    if (!currentPromise || promiseResolve === undefined) {
      currentPromise = new Promise((resolve) => {
        promiseResolve = resolve;
      });
    }

    timeoutId = setTimeout(() => {
      const result = fn.apply(this, args);
      if (promiseResolve) {
        promiseResolve(result);
        promiseResolve = undefined;
      }
    }, delay);

    return currentPromise;
  } as DebouncedFunction<T>;

  // Add cancel method
  debouncedFn.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (promiseResolve) {
      promiseResolve(fn());
      promiseResolve = undefined;
    }
  };

  return debouncedFn;
}
