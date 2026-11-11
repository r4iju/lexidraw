const PAGES = {
  document: "/documents",
  drawing: "/drawings",
  directory: "/dashboard",
  url: "/urls",
} as const;

/**
 * `id` as exactly one path segment. A link from a stored id must open that
 * entity's page even when the id was planted to look like a path.
 */
function segment(id: string) {
  // "." and ".." step out of the page however they are percent-encoded, so
  // they are escaped twice: the page receives "%2E" and answers not found.
  if (id === "." || id === "..") return id.replaceAll(".", "%252E");
  return encodeURIComponent(id);
}

/**
 * The app path that opens the entity of `type` with `id`; an unknown type
 * opens as a link. Every place that turns an entity id into a URL uses this.
 */
export function entityPath(type: string, id: string) {
  const page = PAGES[type as keyof typeof PAGES] ?? PAGES.url;
  return `${page}/${segment(id)}`;
}
