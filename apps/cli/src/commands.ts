/**
 * CLI command names mapped to the operationId `trpc-to-openapi` derives from
 * the procedure path. The nouns and verbs in docs/agent-access.md land here as
 * later tickets expose them over REST.
 */
export const COMMANDS: Record<string, string> = {
  "auth status": "auth-me",
  "drawing create": "drawings-create",
  "drawing delete": "entities-delete",
  "drawing get": "drawings-get",
  "drawing put": "drawings-put",
  "drawing render": "drawings-render",
  "dir create": "entities-create",
  "dir list": "entities-list",
  "doc append": "documents-appendMarkdown",
  "doc create": "entities-create",
  "doc delete": "entities-delete",
  "doc get": "documents-getMarkdown",
  "doc insert": "documents-insertMarkdown",
  "doc list": "entities-list",
  "doc put": "documents-replaceMarkdown",
  "doc render": "documents-render",
  search: "entities-search",
};

export const KNOWN_COMMANDS = Object.keys(COMMANDS).sort();
