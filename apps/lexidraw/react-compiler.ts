/**
 * The React Compiler's options, apart from `next.config.ts` so the test that
 * compiles the app with them can import them without loading the app's env.
 */
export const reactCompiler = {
  compilationMode: "infer",
  panicThreshold: "critical_errors",
} as const;
