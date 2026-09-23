# Drawing format

`PUT /api/v1/drawings/{id}` and `POST /api/v1/drawings` take a drawing's whole
element set, and [Rendering](#rendering) draws what is stored. Two shapes go
in, one comes out: whatever you send is stored as canonical Excalidraw
elements, the same ones the browser editor writes.

## The two shapes

An element is **shorthand** when it carries none of the bookkeeping the editor
stamps on what it saves (`version`, `versionNonce`, `seed`, `isDeleted`), or
when it carries one of the fields only shorthand has (`label`, `start`, `end`,
`children`). Anything else is a **canonical element**. The two may be mixed in
one array; see [Mixing](#mixing).

Array order is z-order: the first element is furthest back.

### Shorthand

Shorthand is the format the official Excalidraw MCP writes, so an agent that
learned it there already knows this one. The server expands it with
Excalidraw's own converter, which is what gives labels their text elements,
arrows their bindings, and frames their membership.

```json
[
  {
    "type": "rectangle",
    "id": "ingest",
    "x": 0,
    "y": 0,
    "width": 220,
    "height": 100,
    "backgroundColor": "#a5d8ff",
    "fillStyle": "solid",
    "roundness": { "type": 3 },
    "label": { "text": "Ingest", "fontSize": 20 }
  },
  {
    "type": "rectangle",
    "id": "index",
    "x": 420,
    "y": 0,
    "width": 220,
    "height": 100,
    "backgroundColor": "#b2f2bb",
    "fillStyle": "solid",
    "roundness": { "type": 3 },
    "label": { "text": "Index", "fontSize": 20 }
  },
  {
    "type": "arrow",
    "id": "ingest-to-index",
    "x": 230,
    "y": 50,
    "label": { "text": "batches" },
    "start": { "id": "ingest" },
    "end": { "id": "index" }
  },
  {
    "type": "stickynote",
    "id": "todo",
    "x": 0,
    "y": 220,
    "text": "Backfill still runs nightly"
  },
  {
    "type": "frame",
    "id": "pipeline",
    "children": ["ingest", "index"],
    "name": "Pipeline"
  }
]
```

The element types:

| `type` | required | notable optional fields |
| --- | --- | --- |
| `rectangle`, `ellipse`, `diamond` | `x`, `y` | `id`, `width`, `height`, `label`, and any styling field |
| `text` | `x`, `y`, `text` | `id`, `fontSize` |
| `arrow`, `line` | `x`, `y` | `id`, `points`, `label`, `start`, `end` |
| `frame`, `magicframe` | `children` | `id`, `name` |
| `stickynote` | `x`, `y`, `text` | `id`, `width`, `height`, `fontSize`, `backgroundColor` |

`label` is `{ "text": "...", "fontSize": 20, ... }`. It becomes a text element
bound to the shape or arrow: the container grows to fit it, the text gets a
`containerId`, and the container gets a `boundElements` entry. Labels are
measured server-side from the font size and the character count, because there
is no canvas to measure with; a label is laid out, not pixel-perfect.

`stickynote` is ours, not Excalidraw's. It is a `rectangle` with the note
colour `#fff9db`, `fillStyle: "solid"`, sides of 180, and its `text` as the
label; every one of those is overridable, and the result is stored as an
ordinary labelled rectangle.

### Canonical elements

Elements that came from a `GET`, or from the editor, go back as they are, bar
the normalization below. Each one needs `type`, a non-empty `id`, and finite
`x`, `y`, `width`, `height`. Fields the editor reads positionally are checked
too — `points` as pairs of numbers, `text` on a text element, a binding as
`{ "elementId": "..." }` — and anything else is kept with the value you sent,
including on `isDeleted` elements, so reading a drawing, changing one element
and writing it back loses nothing.

```json
[
  {
    "id": "ingest",
    "type": "rectangle",
    "x": 0,
    "y": 0,
    "width": 220,
    "height": 100,
    "angle": 0,
    "strokeColor": "#1e1e1e",
    "backgroundColor": "#a5d8ff",
    "fillStyle": "solid",
    "strokeWidth": 2,
    "strokeStyle": "solid",
    "roughness": 1,
    "opacity": 100,
    "groupIds": [],
    "frameId": "pipeline",
    "index": "a0",
    "roundness": { "type": 3 },
    "seed": 1968410350,
    "version": 12,
    "versionNonce": 1160978969,
    "isDeleted": false,
    "boundElements": [{ "type": "text", "id": "ingest-label" }],
    "updated": 1758621600000,
    "link": null,
    "locked": false
  }
]
```

## Normalization

Whatever you send, shorthand or canonical, is run through Excalidraw's own
`restoreElements` before it is stored — the same pass the editor runs over a
scene it is about to open. It fills in missing defaults, gives every element
its ordering index, and repairs bindings against what is actually in the
payload, so a binding to an element you did not send is dropped rather than
left for the editor to trip over. What is stored is therefore what the browser
would have made of your payload, which is not always byte for byte what you
sent. Text dimensions are the exception: they are left alone, because this
process has no fonts to re-measure them with.

## Limits

- At most 10,000 elements per request.
- The app is deployed behind a 4.5 MB request body limit. A drawing that large
  is unusual; splitting a write is not possible, so keep payloads to the
  elements that changed plus the rest of the scene, and prefer shorthand, which
  is far smaller than canonical elements.

## Bindings

- `start` and `end` on an `arrow` or `line` name the element the arrow attaches
  to, as `{ "id": "ingest" }`. The arrow comes out with `startBinding` and
  `endBinding` pointing at them, and each bound shape gains a `boundElements`
  entry, so dragging a box in the editor drags its arrows along.
- `{ "type": "rectangle" }` without an `id` asks for a new shape at that end
  instead, and `{ "type": "text", "text": "..." }` for a new text element.
- `children` on a `frame` lists the ids that belong to it. Each one comes out
  with `frameId` set to the frame.
- Both resolve **only against shorthand elements in the same request**. Binding
  to a canonical element in the same array, or to an element already stored in
  the drawing, fails with `BAD_REQUEST` naming the id, rather than storing an
  arrow that quietly points at nothing.
- Ids must be unique across the request. A duplicate fails with `BAD_REQUEST`:
  the converter keeps only the first, and the loss would otherwise be silent.

## Mixing

Canonical elements keep their positions in the array. The shorthand elements
are converted as one batch, wherever they sit, and the batch is spliced in
where the first of them was. That is why bindings only reach shorthand: the
converter is shown the shorthand batch and nothing else.

## What you get back

`PUT` answers with `{ id, updatedAt, elementCount }`, where `elementCount`
counts stored elements, so a payload of two labelled boxes and an arrow comes
back as more elements than you sent. `GET /api/v1/drawings/{id}` answers with
`{ id, title, elements, appState, updatedAt }`, `elements` parsed rather than
as a JSON string.

Ids survive normalization. An id you give a shorthand element is the id it is
stored under, so the next request can bind to it or replace it. Elements the
converter invents — a label's text element, an arrow's new endpoint — get
generated ids.

## Preconditions

`ifUnmodifiedSince` is the `updatedAt` of the revision you read, and `PUT`
requires it: it replaces every element, which is the one write that cannot be
merged after the fact. The write is a compare-and-set on it, so a save from a
browser that landed in between fails with `CONFLICT` and
`data.currentUpdatedAt` to re-read from, instead of overwriting it. A caller
with no revision to name wants `POST /api/v1/drawings` instead.

From the CLI, `lexidraw drawing put <id> --file elements.json
--if-unmodified-since <iso|latest>` is the same write; `latest` reads the
revision immediately before writing, for a caller that accepts whatever is
stored this second.

## Rendering

`GET /api/v1/drawings/{id}/render?format=svg|png` draws the stored elements
with Excalidraw's own SVG export, running server-side. `format` defaults to
`svg`; `scale`, 1 to 4, multiplies the raster and is ignored by `svg`.

The image comes back in the JSON body, because every REST path here is served
by one adapter that answers `application/json`:

```json
{
  "id": "abc",
  "format": "png",
  "contentType": "image/png",
  "encoding": "base64",
  "width": 660,
  "height": 120,
  "data": "iVBORw0KGgo...",
  "updatedAt": "2026-09-23T10:00:00.000Z"
}
```

`data` is the SVG source for `format=svg` and the base64 PNG for `format=png`,
as `encoding` says; `contentType` is what those bytes would be served as, and
`width` and `height` are the image's, so a PNG at `scale=2` reports twice the
SVG's. `updatedAt` is the revision that was rendered.

From the CLI, `lexidraw drawing render <id> [--format svg|png] [--scale 1-4]
[--out <file>]` decodes it: without `--out` the image goes to stdout, the SVG
as text and the PNG as bytes, which it refuses to write to a terminal.

### Fonts

The PNG is drawn with the editor's own faces, which ship with the server, so a
label rasterises in the font it was drawn in. The SVG names the font families
— `Excalifont`, `Nunito`, `Comic Shanns`, `Liberation Sans` and the rest —
without embedding them, so a viewer that does not have them installed
substitutes and the text moves. Embedding is what would make a render fetch
the faces at request time, which is not something a render is allowed to do.

The CJK fallback face, Xiaolai, is not bundled: it is 25 MB of subsets. CJK and
emoji text is in the SVG either way, but comes out of the PNG in whatever the
raster can find, which on a serverless filesystem is nothing.

### Size and limits

The export pads the elements' bounding box by 10 scene units and paints the
drawing's own `viewBackgroundColor`, white if it never set one. A raster over
16 megapixels is refused with `BAD_REQUEST` naming the limit — lower the scale
or ask for `svg`, which has no limit. Elements that reference uploaded images
render as empty frames: a render reads the stored elements, not the file store.

Labels were measured server-side when they were written, by character count
rather than by a font, so a line can sit a pixel or two off where the browser
would put it. The geometry around it is the editor's own.

## Mermaid

Mermaid is not a write format. `{ "type": "mermaid" }`, or a `mermaid` string
on the request or on any element, fails with `BAD_REQUEST`:

> Mermaid is not a write format; convert it in the browser

Mermaid's layout needs a real browser; the editor's own Mermaid dialog does the
conversion there and saves the elements it produces.
