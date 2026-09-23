/**
 * What the server needs to register the widget: the URI it lives at, the
 * `_meta` key its payload travels under, and the domains it asks the host to
 * allow. The document itself is a separate entry point — see `./html` — so a
 * route that only calls a tool never loads five megabytes of editor.
 */
export * from "./protocol";
