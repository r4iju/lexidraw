/**
 * The React Compiler's options. `next.config.ts` hands them to Next, and
 * `src/test/react-compiler.test.ts` compiles the app with them.
 */
export const reactCompiler = {
  compilationMode: "infer",
  panicThreshold: "critical_errors",
} as const;
