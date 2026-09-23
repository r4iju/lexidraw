/**
 * CLI command names mapped to the operationId `trpc-to-openapi` derives from
 * the procedure path. The nouns and verbs in docs/agent-access.md land here as
 * later tickets expose them over REST.
 */
export const COMMANDS: Record<string, string> = {
  "auth status": "auth-me",
  "doc get": "entities-load",
};

export const KNOWN_COMMANDS = Object.keys(COMMANDS).sort();
