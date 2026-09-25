/**
 * Points Excalidraw's font-cutting worker at the copy the app serves from
 * `options.url` (see `scripts/excalidraw-assets.ts`), in place of the
 * `file://` address Turbopack gives it. Fails the build when a new version
 * finds its worker some other way, rather than quietly working on the page.
 */
const WORKER_URL =
  /import\.meta\.url\s*\?\s*new URL\(import\.meta\.url\)\s*:\s*void 0/;

module.exports = function excalidrawWorkerLoader(source) {
  const { url } = this.getOptions();
  if (!WORKER_URL.test(source))
    throw new Error(
      "@excalidraw/excalidraw no longer finds its worker at import.meta.url; update excalidraw-worker-loader.cjs",
    );
  return source.replace(
    WORKER_URL,
    `typeof self === "undefined" ? void 0 : new URL(${JSON.stringify(url)}, self.location.href)`,
  );
};
