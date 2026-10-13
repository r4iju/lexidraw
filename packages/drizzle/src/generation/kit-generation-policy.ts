/** Direct configured Kit generation cannot recreate the immutable V1 archives. */
export function enforceArchiveGenerationEntrypoint(args: readonly string[]) {
  if (args.some((arg) => arg === "generate" || arg.startsWith("generate:"))) {
    throw new Error(
      "Use db:generate; configured Kit generation cannot enforce the manual archive migration contract",
    );
  }
}

enforceArchiveGenerationEntrypoint(process.argv.slice(2));
