# Domain vocabulary

- **HTML block** — Self-contained interactive content saved inside a document, authored through an authorized external agent.
- **Saved source** — A block's HTML, CSS, JavaScript, embedded data, starting defaults, description, and bounded height. Viewer interactions never change it.
- **Block identity** — The stable identifier retained when an agent revises a block.
- **Saved revision** — The content identity covering all saved source fields, including forward-compatible fields. Changing saved content changes its revision.
- **Running instance** — One reader's temporary interactive view, created explicitly by Run and disposed on Restart, source invalidation, or leaving the view.
- **Saved-state preview** — A passive image captured from a fresh instance initialized with the exact saved revision and defaults. It represents no viewer's temporary inputs.
- **Document precondition** — The document's previously read updatedAt value, required for a block write so concurrent edits cannot be overwritten.
