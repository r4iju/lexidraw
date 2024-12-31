export default function warnOnlyOnce(message: string) {
  // @ts-expect-error - strict mode
  if (!__DEV__) {
    return;
  }
  let run = false;
  return () => {
    if (!run) {
      console.warn(message);
    }
    run = true;
  };
}
