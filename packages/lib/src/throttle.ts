// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<F extends (...args: any[]) => any>(
  fn: F,
  delay: number,
): (
  this: ThisParameterType<F>,
  ...args: Parameters<F>
) => Promise<ReturnType<F>> {
  let lastRun = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastPromise: Promise<ReturnType<F>> | null = null;

  return function (
    this: ThisParameterType<F>,
    ...args: Parameters<F>
  ): Promise<ReturnType<F>> {
    const now = Date.now();

    // If this is the first call or enough time has passed
    if (!lastRun || now - lastRun >= delay) {
      lastRun = now;
      return Promise.resolve(fn.apply(this, args));
    }

    // If there's already a pending promise, return it
    if (lastPromise) {
      return lastPromise;
    }

    // Otherwise, schedule the next execution
    return new Promise((resolve) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(
        () => {
          lastRun = Date.now();
          lastPromise = null;
          resolve(fn.apply(this, args));
        },
        delay - (now - lastRun),
      );
    });
  };
}
