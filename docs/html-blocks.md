# Self-contained HTML blocks

HTML blocks are saved document content authored through the CLI or API. Their interactive state belongs only to the current running view. Opening a document shows the saved-state snapshot; **Run** explicitly starts a fresh instance, and **Restart** restores the saved defaults. Readers can run blocks without edit permission. Updating source or embedded data requires document write access and the document's `updatedAt` precondition.

## Author, read, revise, verify

Save this as `calculator.json`:

```json
{
  "html": "<label for='amount'>Amount</label><input id='amount' type='number'><button id='go'>Calculate</button><output id='total' aria-live='polite'></output>",
  "css": "input,button{padding:8px;margin:8px}output{display:block;font-size:32px}",
  "javascript": "const amount=document.getElementById('amount');const total=document.getElementById('total');function calculate(){total.textContent=String(Number(amount.value)*data.rate)}document.getElementById('go').addEventListener('click',calculate);calculate();blockReady();",
  "data": {"rate": 3},
  "defaults": {"amount": 4},
  "description": "Calculator multiplying the entered amount by three",
  "height": 360
}
```

```sh
lexidraw doc get DOCUMENT --format json
lexidraw doc block create DOCUMENT --file calculator.json --at-block 1 --if-unmodified-since UPDATED_AT
lexidraw doc block list DOCUMENT
lexidraw doc block get DOCUMENT --block-id BLOCK_ID
lexidraw doc block preview DOCUMENT --block-id BLOCK_ID --revision REVISION --out calculator.png
lexidraw doc block update DOCUMENT --block-id BLOCK_ID --file revised-calculator.json --if-unmodified-since UPDATED_AT
lexidraw doc block delete DOCUMENT --block-id BLOCK_ID --if-unmodified-since UPDATED_AT
lexidraw schema doc block create
```

`--at-block` inserts before the root-level block at that zero-based index; the block count appends. Create returns the stable block `id`, content `revision`, and document `updatedAt`. Reads return the exact saved source and defaults without retrieving the rest of the document. Update replaces the known source fields and preserves identity and unknown forward-compatible fields. Read first and copy its source into the revision file before changing your dataset. `--if-unmodified-since latest` explicitly reads the current document precondition; the final write still uses compare-and-set. Stale writes fail with 409 and an actionable revision. Delete removes only the selected block. Missing or duplicate identities fail rather than guessing.

The corresponding REST paths under `/api/v1` are `GET/POST /documents/{id}/html-blocks`, `GET/PUT/DELETE /documents/{id}/html-blocks/{blockId}`, and `GET /documents/{id}/html-blocks/{blockId}/preview?revision=...&width=800`. POST takes `{source,atBlockIndex,ifUnmodifiedSince}`; PUT takes `{source,ifUnmodifiedSince}`; DELETE takes the `ifUnmodifiedSince` query parameter. REST uses the caller's normal bearer token; a read token cannot mutate. Preview returns a base64 PNG with `status`, exact content revision and dimensions, or an explicit failed result. Permission and revision are checked again after capture. No preview is published to a public asset bucket.

## Supported interaction contract

This first version is self-contained, with a deliberately small DOM API. JavaScript runs in a bounded QuickJS WebAssembly interpreter; it never runs as browser JavaScript. The browser presents validated HTML/CSS in a script-disabled sandboxed iframe. The source is saved unchanged; validation does not silently convert executable markup into another block.

- Separate `html`, `css`, and `javascript` fields. Inline `<script>`, event attributes, forms, anchors, iframes, metadata, external images and other active elements are rejected. Basic text, layout, lists, tables, labels, inputs, buttons, selects/options, textareas, outputs, details, progress/meters and inline PNG/JPEG/WebP data images are supported.
- `document.getElementById`, `querySelector`, `querySelectorAll`, `createElement`, `body`; element queries, `appendChild`, allowlisted attributes, `textContent`, validated `innerHTML`, `value`, `checked`, `disabled`, `selectedIndex`, `className`.
- `addEventListener` for click/input/change/keydown/keyup; event target and key are available. `preventDefault` and `stopPropagation` are compatibility no-ops; widgets cannot trap page keyboard focus. Promise jobs run within bounds. Browser timers, focus APIs, remote libraries and full browser DOM compatibility are outside this version.
- `data` is the embedded JSON dataset. `defaults` maps control IDs to initial strings/numbers/checkbox booleans. Call `blockReady()` once the saved initial view is complete; missing readiness or script errors produce a bounded failure. Plain HTML with empty JavaScript is ready automatically.
- No host DOM/session, navigation, network, cookies, storage, workers, popups or privileged document APIs. CSS and image loads are additionally constrained by CSP. Source never receives host functions or DOM objects: the interpreter's bridge carries validated JSON primitives only.

Saved content is at most 128 KiB, JSON nesting at most 32 levels, description at most 500 characters, frame height 180–900 px, and preview width 320–1280 px. The interpreter has an 8 MiB memory limit, 256 KiB stack, 200 ms per execution/event, 100 pending jobs per turn, 20,000 total bridge operations, 2,000 DOM handles/elements, 1,000 listeners and 512 KiB DOM output. Failure stops the instance; Restart is available. While a view is running and visible, its protected source is checked every five seconds; a changed revision or lost access disposes the instance, and running again requires a fresh authorized read. Frames use fixed bounded sizes and no sizing messages.

Capture uses a fresh interpreter and a blank Chromium page with browser JavaScript disabled, all browser requests blocked, no session cookies and no render credentials injected. At most two captures run concurrently per worker instance; each browser closes within 15 seconds. Static PNG/PDF document exports include saved-state images; failed capture stays visible as a fallback. Current viewer inputs never enter capture or document saves.

## Native display and preservation

The iOS document flow displays the revision-matched PNG with an accessible description and an explicit **Open interactive block in browser** action. The URL contains only the normal document route and block fragment, never a session token; the browser applies its usual sign-in/sharing rules. Native display uses UIImage, not a web runtime. Failed/offline/stale snapshots fall back visibly. Native serialized payloads keep source, data, defaults, identity, and unknown fields through load/save, and read-only documents remain read-only.

Markdown reads retain an identifiable `<!-- lexidraw:html-block#N ... -->` placeholder. Markdown replacement resolves that placeholder back to the original block. Ordinary code blocks or pasted HTML do not become executable HTML blocks. Browser source editing is through the authorized CLI/API only, independent of in-app AI.

See [Notion research](notion-html-block-research.md) for the documented product precedent and the limits of the publicly described sandbox guarantees.
