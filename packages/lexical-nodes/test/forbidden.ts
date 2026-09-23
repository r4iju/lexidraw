export const FORBIDDEN_MODULES = ["react", "react-dom", "next"];

const pattern = new RegExp(`/node_modules/(${FORBIDDEN_MODULES.join("|")})/`);

/** Paths of forbidden modules that are in this process's module graph. */
export function loadedForbiddenModules(): string[] {
  return Object.keys(require.cache).filter((path) => pattern.test(path));
}
