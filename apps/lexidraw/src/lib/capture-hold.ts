let held = 0;

/**
 * Keeps a page renderer from capturing until the returned release is called:
 * for code a block loads for itself that changes what is already drawn, such
 * as a code block's highlighting, where no placeholder is marked busy. A
 * block that is replaced by a placeholder while it loads marks that busy
 * instead. Releasing twice releases once.
 */
export function holdCapture(): () => void {
  held++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held--;
  };
}

/** Whether some work still holds the capture. */
export function captureHeld() {
  return held > 0;
}
