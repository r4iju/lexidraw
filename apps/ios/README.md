# Lexidraw for iOS

`xcodegen generate` writes `Lexidraw.xcodeproj` from `project.yml`; the
project isn't committed. To point a build at a local server, build with
`LEXIDRAW_SERVER_URL=http://localhost:3025`. Leave code signing on: an app
built with `CODE_SIGNING_ALLOWED=NO` can't keep its token in the Keychain, so
it can't sign in. The simulator's ad-hoc signing is enough.

LexicalSwift follows the Lexical version the web editor uses. To upgrade
Lexical, see [Upgrading Lexical](../../docs/lexical-upgrade.md).

## Corpus check

`bun run test:corpus` loads and saves every document an account owns with
both LexicalSwift and Lexical, and fails on any difference. It takes the
token from `LEXIDRAW_TOKEN`, or else the CLI's in the Keychain, and the host
from `LEXIDRAW_URL`. Failures name documents by id, never by content. In CI
the **iOS** workflow runs it with the repository secret
`LEXIDRAW_CORPUS_TOKEN`, a Lexidraw API token; without it the check is
skipped.

## Differential fuzzer

`FUZZ_SEED=<n> FUZZ_STEPS=<n> swift test --filter lexicalSwiftMatchesTheReference`
runs LexicalSwift and Lexical side by side on random commands. Steps count
only commands both accepted. Last run, on macOS 27 with words from
`Intl.Segmenter`: seeds 101 to 110, 100,000 steps each, 1,000,000 in all,
with no divergence; 632 commands were refused by both, for the same reason.
With Markdown shortcuts (#115), whole shortcuts typed at once, then Enter or
committed as a composition: seeds 1, 7, 42, 2026 and 987654321, 20,000 steps
each, 100,000 in all, with no divergence; 1,964 commands were refused by
both, and 287 sessions ended where Lexical made a node LexicalSwift doesn't
make yet. With lists, checklists and their shortcuts (#116): seeds 11621 to
11625, 20,000 steps each, and seed 11610, 200,000 steps, 300,000 in all,
with no divergence; 5,693 commands were refused by both, and 122 sessions
ended on a shortcut or node not ported yet. With links, autolinks, their
shortcut, copy, cut and paste (#118), pasting what the last copy or cut
put on the clipboard, or text, some with HTML, as from another app: seeds
1 to 10, 20,000 steps each, and seed 11, 100,000 steps, 300,000 in all,
with no divergence; 9,122 commands were refused by both, and 270 sessions
ended on a shortcut or node not ported yet. With tables, table selections,
arrow keys and GFM table rows (#117), a quarter of the shortcuts typed being
a row of random markdown cells, and a rule selected whole: seeds 1, 7, 42,
2026, 987654321 and 11701 to 11705, 20,000 steps each, and seed 11700,
200,000 steps, 400,000 in all, with no divergence; 64,524 commands were
refused by both, 253 sessions ended on a shortcut or node not ported yet,
and 26 where neither model could read its selection back: a table
selection over a hole in its table, where a cell spans rows past the
table's end, or of a cell a command removed. `FUZZ_SEED=<n>
FUZZ_STEPS=<n> swift test --filter randomCellsImportAsLexicalImportsThem`
types a row of random markdown cells, links among them, for each ten
steps: seeds 1, 2, 3, 42 and 2026 at 20,000 steps, and 7 and 99 at
200,000, 50,000 rows in all, with no divergence; 812 held markdown not
ported yet, which LexicalSwift declines, leaving the row as typed.

With the table menu (#173), including merge/unmerge, cell backgrounds,
headers, deleting the table and counted row/column insertion: seeds 17301,
17302 and 17303, 20,000 steps each, 60,000 in all, with no divergence;
10,682 commands were refused by both, 43 sessions ended on a shortcut or
node not ported yet, and one on the same unreadable table selection.

## Editor harness and UI scripts

The **EditorHarness** scheme is an app with one document in the TextKit
editor (`Sources/TextKitEditor`), for trying the editor on a simulator. It
edits with LexicalSwift, or with the JS reference when launched with
`EDITOR_MODEL=reference` (run `bun run build:reference` before building).
Save writes the document to `EDITOR_SAVE_PATH`, or `saved.json` in its
Documents, and each call the keyboard made on the editor to
`EDITOR_INPUT_LOG`.
With `EDITOR_PREVIEW_ACCESS` it opens the app's document screen instead, for
`DocumentPreviewUITests`, as `EditorHarness/DocumentPreview.swift` says.

`bun run test:ui` runs the scheme's tests on a simulator it makes and
deletes after (`scripts/test-ui.sh`): the UI scripts, `EditorUITests`, and
`TextKitEditorTests` on iOS, where `EditorViewTests` run the hardware keys
XCUITest can't press. The UI scripts type through the simulator's keyboards,
once with each model, and compare the document the harness saves. The
Japanese script composes on the software keyboard and checks three things:
that the keyboard made the calls recorded in
`EditorUITests/Fixtures/web-composition.json`, that the view showed each
composition where the caret was, and that the harness saved what the web
editor saved for the same calls. `bun run record:composition` records both
sides: the UI script writes the calls, then `recording/composition.ts` makes
them through Chrome's IME input on a local dev stack (`LEXIDRAW_DEV_URL`)
with the dev account and adds what the web saved.

`bun run measure:scroll` scrolls #108's synthetic documents, generated by
`SyntheticDocument` and never real ones, through the editor in a Release
build of the harness under Instruments (`scripts/measure-scroll.sh`), on an
iPhone 13 simulator it makes and deletes after, or on a device named by
`MEASURE_DEVICE`. The harness jumps to the middle, scrolls up to the top and
down to the bottom a fixed distance a frame, and reports the time to the
first screen, each frame's interval and work, how far text on screen moved
beyond the scroll, and memory. `measure/summary.ts` adds the Core Animation
commits and hangs Instruments saw, and prints a table. The simulator draws
at 60 Hz and runs on the Mac's CPU, so #108's frame budgets want a device.

## Drawing harness and UI tests

The **DrawingHarness** scheme is an app with the drawing editor on a bundled
drawing, `DrawingHarness/drawing.json`, and no server: it answers the
editor's calls itself and keeps saves in memory. `bun run test:drawing-ui`
runs its UI tests, `DrawingUITests`, on a simulator it makes and deletes
after (`scripts/test-drawing-ui.sh`). They press keys on the simulator's
hardware keyboard, and once one is pressed no software keyboard comes up
until the next boot, so the tests that check the software keyboard run
first, alone, on the fresh boot. Both harnesses show how many hardware keys
reached them unhandled, and both UI test targets press keys through
`UITestSupport/HardwareKeyboard.swift`, which waits for that count before
the first real key. `scripts/simulator.sh` makes the simulators for both
scripts.

## TestFlight

The **iOS TestFlight** workflow runs by hand on `master`. It tests, archives,
signs and uploads a build numbered by the run. What it needs, set up once by
hand:

- An App Store Connect app record for `xyz.raiju.lexidraw`, with no
  capabilities, and the share extension's bundle ID
  `xyz.raiju.lexidraw.share` registered in the developer portal.
- An App Store Connect API team key (App Manager), as the repository secrets
  `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` (the whole `.p8`), and the
  team ID as the variable `APPLE_TEAM_ID`.
- An internal TestFlight group with automatic distribution. An upload from
  `xcodebuild` can't name a group, so this is what gets each build to testers.

## Decisions

- Release builds talk to `https://lexidraw.vercel.app`, the host the CLI uses.
  `https://dev.hackdocean.com` is behind Cloudflare Access, which answers the
  app's API calls with a login page.
- Home lists with the web's default sort, last changed first. It ignores the
  sort the web saves in a cookie.
- A device signs in under its model name, "iPhone" or "iPad", so two phones
  share a name in the web's list of API tokens.
- The TestFlight group is set up by hand, as above.
- A new file asks for its name straight away, as a new folder in Files does.
  The web opens the new file instead, which the app cannot do yet.
- Documents autosave after edits pause, exporting state at save time rather
  than on every keystroke. Each REST save sends the revision last read or
  saved. A conflict offers Reload Theirs or Keep Mine as a Copy; the copy is
  a new file at Home, with the same settings, and never replaces their edits.
  Copy creation reuses its id on retries. Settings are saved in a second
  guarded request; if that fails, the screen names the file and offers retry.
- A document shared to read opens without a keyboard but can be selected
  and copied. Until its remaining node families are ported, a document with
  opaque nodes also opens read-only and explains why. Its original JSON is
  preserved; the app does not approximate unsupported editing.
- Document language and font settings use a generated bundle of the existing
  pure web settings helpers, evaluated once on load. Generated stylesheet
  variables select the reading stack; native CoreText shapes and TextKit lays
  out the selected font. This adds no JavaScript editing or layout. Custom
  families come from the existing public `/api/fonts` provider, with WOFF2
  family verification, token-free third-party requests, four concurrent
  downloads and limits of 4 MiB per face and 64 MiB per family. All unicode
  subsets load for later edits. An unavailable font refuses the load with an
  explicit error instead of substituting a different family.
- The share extension signs in with the app's token through a Keychain
  access group named for the app's own App ID, the group the token was
  already kept in. So it needs no app group and no capability in the portal,
  and a token saved by an earlier build stays readable.
- The share extension waits for a link's page to be read before it closes,
  as the web's New link does, so a link never stays titled "New link"
  without saying why.
- Listen starts from a file's menu, since files don't open in the app yet.
- Listen reads in the caller's read-aloud settings from the web, except that
  it makes MP3 where they choose Ogg. Someone who chose Ogg has one audio of
  a file for the web and another for the app.
- Where a listen stopped is kept on the device. The web keeps none to share.
- A document's audio, once made, plays even after the document changes, as
  on the web. Making it again is done on the web.
- Text an input method is composing stays in the view until it is committed,
  and reaches the model as one `commitComposition`, which inserts it as
  `insertText` does in an update tagged as Lexical tags a composition's end,
  so a markdown shortcut it finishes goes off as on the web. The web editor
  saves the same document for a composition as for typing its result, and
  Lexical keeps it as one history step either way.
- The editor-model interface is its own module, `EditorModelInterface`, so
  the editor can't reach into LexicalSwift. Views tell which blocks an
  update added, removed or kept by `childKeys`, as Lexical's reconciler does
  by node key; keys stay out of `ChangeSet`, which the fuzzer compares.
- A line break is U+2028 in the editor's text, which breaks the line without
  ending the paragraph as TextKit sees it.
- Drawings are drawn by `DrawingKit`, a port of Excalidraw's renderer with
  its Rough.js and perfect-freehand, and checked against what web Excalidraw
  draws: `bun run record:drawings` exports the scenes in
  `reference/drawings/scenes.ts` with Playwright, and the tests compare every
  canvas call and the pixels, in both themes. A test drawn with other random numbers must fail the pixel
  comparison, which shows its tolerance still sees a moved stroke.
- An embedded web page shows as its outline, without the name the web writes
  in it.
- CJK text draws in the system's font. The web's Xiaolai is too large to
  bundle, as it is for the server's thumbnails.
- Drawings open for editing when the user may edit them, and read-only
  otherwise. `DrawingEditor` is a port of Excalidraw 0.18.1's editor, gesture
  by gesture. `bun run record:drawings` also plays the scripts in
  `reference/drawings/interactions.ts` in web Excalidraw, with touch as on an
  iPad, and the tests play them here and compare the element JSON, leaving
  out ids, seeds, nonces and times.
- Text is measured as Chrome measures it, to the bit, since a label wraps
  where its width says and a width off by a hair wraps a line differently.
- Two fingers pan and pinch, and a second finger takes back what the first
  had begun. With Only Draw with Apple Pencil on, a finger moves the drawing
  when a drawing tool is chosen. The web instead turns on its pen mode once
  it sees a pen; the app follows the system setting.
- Text is written in a text box over the canvas, as the web writes it in a
  textarea, so while it is being written its glyphs are the system's layout
  of the font.
- Edits save once they pause for a second, each against the revision the last
  save made. A save refused because someone else saved in between asks
  whether to keep these changes or take theirs.
- An element is in the frame it is begun in, and a placed image in the one
  the middle of the screen is in, as a dropped file is in the one it is
  dropped on. A shape let go over a frame joins it, and one let go outside
  leaves it, even while it still overlaps, as on the web. A frame moves with
  what it holds, keeps what its new box holds once resized, and grouping
  takes shapes out of their frames unless all are in the same one.
- An arrow bound to a shape follows it, and an elbow arrow is routed around
  the shapes again as the web routes it, also when a shape it is bound to is
  deleted; the app draws no elbow arrows of its own.
- Entering or leaving a group to edit one of its elements is a step to
  undo, as on the web.
- The style panel offers the web's first five colours of each kind, and the
  system's colour picker for any other. Its sections and the toolbar's
  buttons are the editor's own, so the interaction tests press what a user
  presses.
- A picked image is prepared as the web prepares a dropped file: shrunk to
  1440 pixels a side, and named by the SHA-1 of the bytes stored, the only
  name the server takes. A photo in a kind the server doesn't store, such as
  HEIC, becomes a JPEG, or a PNG when it has transparency. It is placed in
  the middle of the screen and uploaded straight away; an upload that fails
  is tried again after the next edit, and one the server refuses, for what
  it is or because the drawing is full, is marked as the web marks it.
- The file types a drawing stores and the largest file it stores are
  generated from the server's by `bun run codegen`, into
  `Sources/LexidrawJSON/DrawingFiles.swift`.
- An SVG image is drawn by WebKit onto a canvas, as the web draws it, since
  ImageIO doesn't read SVG. An SVG file placed from Files is normalized as
  the web normalizes one, and written out as Chrome writes it, so it is
  stored as the same bytes under the same id.
- A drawing opens fitted to the screen, where the web opens it at 100%.
- The style panel has only the sections #138 asks for: stroke, fill,
  colour, width and roughness.
- A drawing deleted in the app goes to the Trash, which offers only Restore;
  neither the app nor the web deletes one permanently.
- The tools keep the bottom bar to themselves, and what acts on a selection
  joins the top bar, which on a phone folds what doesn't fit into More. The
  web's phone layout likewise keeps the tools in a bar of their own.
- The editor lays out each block at the root on its own (`BlockLayout`),
  not the whole document in one TextKit layout. TextKit has no tables on
  iOS, so in one layout a table is an attachment, a single character, and
  neither the caret nor a selection can go into its cells; laid out per
  block, each cell's text is in the editor's text. Scrolling the 115k-word
  synthetic document also took less work a frame and about half the peak
  memory. The measurements and the gaps left are on #108.
- Markdown shortcuts run the web editor's own transformers,
  `createTransformers()`, generated by `bun run codegen` into
  `Sources/LexicalSwift/MarkdownTransformers.swift`; their regular
  expressions run in JavaScriptCore, so they match as the web's do. Typing
  that a transformer LexicalSwift doesn't run yet would turn into something
  else stays as typed; `MarkdownTransformer.notPortedYet` lists those
  transformers by the issue that ports each, and the fuzzer ends a session
  on one of them as `Fuzzer.isNotPortedYet` says.
- Headings, quotes and rules are set as `document.css` sets them, generated
  by `bun run codegen` into `Sources/TextKitEditor/WebTypography.swift` with
  the theme's colours converted from OKLCH to sRGB. An em is the body text's
  size, so the reader's text size scales them; the web's line heights and
  space between blocks apply to paragraphs too, text is centred in its line
  as CSS centres it, and a view no wider than the web's narrow container,
  639 points, sets top-level headings smaller as a phone's browser does. A
  document in Japanese or Chinese (`Typesetting.language`) has the web's
  taller lines and wider letters.
- The keyboard formatting bar provides text formats, links, undo/redo and
  block/list menus. Its block choices and hardware shortcut bindings are
  generated from the web controls. Heading 4 is offered in the block menu;
  headings 5 and 6 remain available through Markdown, as on the web.
  #135 still owns remaining insertion actions, and
  #132 owns the code-block command. Insert actions from media/drawing owners
  join the native table menu through `EditorView.insertionActions`.
- A tap on a checklist item's box, or just past it, checks or unchecks the
  item and leaves the caret where it was, as the web's MobileCheckListPlugin
  does on a phone.
- Lists and checklists are laid out and coloured as `document.css` sets
  them, generated by `bun run codegen` alongside the headings' typography.
- Tab indents where the selection starts at the start of a block or spans
  blocks, and types a tab elsewhere, as the web's TabIndentationPlugin does.
  A tab lines up to a browser's default tab stops.
- Links, autolinks and the clipboard follow the web editor's own
  configuration, not a description of it. Its autolink matchers,
  `validateUrl`, `sanitizeUrl`, link editor's save and namespace live in
  `@packages/lexical-nodes/links`, which the web editor and the reference
  import and codegen bundles into `LinkConfiguration.swift` for LexicalSwift
  to run in JavaScriptCore. JavaScriptCore has no `URL`, so the reference
  and the bundle carry whatwg-url's, the URL Standard's own, over the
  `TextEncoder` and `TextDecoder` LexicalSwift defines.
- The model's link and clipboard commands are the web's: `toggleLink` is
  `TOGGLE_LINK_COMMAND`, `editLink` is the floating link editor's save,
  and `copy`, `cut` and `paste` are rich text's.
- Copy puts plain text and Lexical's JSON (`application/x-lexical-editor`)
  on the pasteboard, and no HTML. Other apps get the plain text. Lexical's
  JSON that Lexical can't insert where the caret is goes in as the plain
  text, as on the web.
- HTML pasted from another app keeps the registered converters' text formats,
  links, headings, quotes, lists and tables. Nodes not edited yet are refused
  naming their owning ticket. HTML identical to plain text uses the plain-text
  importer, as Safari autocorrect requires.
- The edit menu offers Add Link for a selection, and Open, Edit and Remove
  for a caret in a link, Open only for the protocols the web opens a link
  with; a tap on a link's text offers the same. Saving no URL keeps the
  link, as on the web. A caret
  just after a link's last character is in the link, as a browser puts it
  in the text before it.
- Typing `[text](url)` makes a link by Lexical's own LINK transformer. Its
  `unescapeText` is ported: a backslash escapes punctuation and a character
  reference in the URL decodes as on the web, and the fuzzer types both. One
  past Unicode fails as on the web, and the model then keeps what was typed
  and reports the error, as Lexical reports it to `onError`.
- Tables edit as `@lexical/table` 0.51 edits them with the web's
  `TablePlugin` settings. The reference registers those settings and the
  web's insert handler from `packages/lexical-nodes` (`tables.ts`), which the
  web uses too, rather than a copy. Cells selected together are a
  `Selection.table`, holding the table's path, the anchor and focus cells and
  every cell selected, as Lexical's `TableSelection` does.
- No table goes inside a table, whether the caret is in a cell or cells are
  selected. `@lexical/table` refused only the first, so the web's insert
  handler now refuses both (#117), and the web's GFM table transformer now
  leaves a row typed or imported inside a cell as text.
- A row typed under a table with as many columns joins it, with the caret at
  its end. The web's table transformer meant to do this but selected the
  table it had just emptied, so the shortcut failed and left the text; it
  now selects the end of the table joined (#117).
- A row typed as GFM, such as `|a|b|` and a space, makes a table as the web's
  table transformer does, taking in the rows typed above it; a divider row
  under a table makes its last row a header row, aligned as the colons say,
  with the caret at the table's end. The web's transformer left the caret
  where removing the divider put it, beside the table, and now selects the
  table's end as its other branches do (#117).
  Each cell's text is imported as `@lexical/markdown`'s importer imports it
  (`MarkdownImport.swift`, apart from the transformer, since the web runs the
  same importer): the `\n` and `\|` escapes, lines, headings, quotes, rules,
  lists and checklists, emphasis and code by CommonMark's delimiter rules,
  backslash escapes and character references. A cell holding markdown that a
  transformer LexicalSwift doesn't port yet, such as a link or a code block,
  leaves the whole row as typed; `MarkdownTransformer.notPortedYet` names
  the issue that ports each, and porting it turns it on inside cells too.
- A character reference past Unicode's end, such as `&#99999999;`, makes the
  web's import throw, so the shortcut's update fails and the row stays as
  typed. LexicalSwift refuses the command as the reference does, keeping
  the text typed before it.
- What `@lexical/table` does only in the DOM isn't modelled: dragging across
  cells, which the view turns into a table selection by sending the range,
  as the DOM's selection change does; the paragraph
  `$getTableEdgeCursorPosition` adds at a table's edge; typeahead;
  right-to-left and vertical writing; pointer and triple-click selection;
  Escape; and the observer's DOM bookkeeping. Arrow keys at a table's edge
  put a caret beside it, as the web's keyboard does.
- Up and Down select a rule they move toward from an empty block, from
  beside it, or from a block with text where the platform's line move
  leaves the block or doesn't move: rich text asks the DOM's selection, and
  the command's `native` point is where the platform's move goes. No inline
  element in the web's editor displays as a grid, so rich text's line move
  past inline grids never runs.
- A rule an arrow or Backspace reaches is selected whole, as Lexical's
  `NodeSelection`, in both models. Backspace and Delete remove it; Enter and
  Shift-Enter start the block after it; copy and cut take it, with `\n` as
  its text; pasted nodes take its place and pasted text goes nowhere; a link
  wraps it in a link of its own; a list lists the block it's in; typing,
  formats, block types, indenting and Tab leave it be, as they answer a range
  only. The view outlines it as the web outlines a selected embed, and
  highlights no text.
- Writing Direction in the edit menu offers Automatic, Left to Right and
  Right to Left; UIKit's writing-direction commands use the same model
  command. The web offers these in Align. They set the selected text blocks'
  stored `direction`, with `null` for automatic. Node and table selections
  leave direction unchanged. TextKit resolves automatic direction, and the
  arrow command carries the anchor node's parent's resolved direction (the
  first selected node's parent for a node selection), as Lexical reads it
  from computed CSS, so Left and Right leave a selected rule toward the
  correct side.
- A caret beside a table lies flat, under the table before it or else over
  the table after it, as the block cursor of Lexical's playground does,
  since the web's theme gives the block cursor no style.
- Enter over a table selection does nothing, as rich text's Enter answers a
  range selection only. Tab in a cell moves between cells as `@lexical/table`
  moves it, ahead of Tab indentation; over a table selection neither answers,
  so it does nothing.
- A list over a table selection makes a list of each block in its cells, a
  table's in a cell too, as `$insertList` works through the selection's
  nodes. Removing a list, indenting and outdenting answer a range selection
  only, so over a table selection they do nothing, as does a link, which
  `$toggleLink` leaves be.
- Copying a table selection copies the rows and cells selected as a table,
  with their text a tab between cells and a line after each row. In a
  document with a table, a cut goes to each table's cut handler first, which
  copies and then clears the cells selected, or deletes a range, in one
  update; rich text's cut takes the rest in two. The handler is bound to
  each table's DOM on the web, so `tables.ts` copies it. Pasting into a cell
  or over cells goes through the table plugin's handler: a table fills the
  grid from where it's pasted, growing it and merging or splitting cells as
  the table pasted has them merged; text over cells fills a cell for each
  tab and line; a table with anything beside it is turned away, as no table
  goes inside a table.
- Loading gives a table's `colWidths` one width per column, as
  `$tableTransform` does, so a column insert always has a width beside it to
  copy; one without is an invariant failure.
- A table selection is drawn as the web draws it: the theme's primary colour
  at 10% over the selected cells, and no text highlighted. A cell's own
  fill, a header's and, on a narrow screen, the pinned first column's win
  over the tint, as they do in `document.css`, so those cells show no tint
  when selected. The focus-cell and table-outline classes the theme names
  are never applied by `@lexical/table` 0.51, so they aren't drawn.
- Rich text stops typing capitalized, lowercase or uppercase on Enter and
  Tab, as on the web. The web also does on the Space key's keydown, which
  the model doesn't see: typing a space is text like any other.
- Typing over a table selection, or finishing a composition over it, types
  nothing and leaves nothing selected, as on the web; the next key types
  where the selection ended.
- Tables lay out as `document.css` lays out `.document-table`, with its
  padding, borders, header fill, numeric columns aligned right and short
  columns kept whole, but no wider than the text, without the web's 44rem
  measure. Cell fills, stored column widths, a cell's vertical alignment
  and the pinned first column on a narrow screen are drawn; the web's
  floating cell menu is left out.
- The web's table menu is the Table menu in the edit menu: Insert Table…
  with the web's dialog, five rows and columns to begin with, or in a table
  inserting rows and columns and deleting them. Deleting the table, headers
  and merging cells are left out.

## Rich HTML paste

HTML paste parses with the system libxml2 HTML parser, without network access,
into an inert tree of text and attributes. `bun run codegen` bundles the web's
unmodified `$generateNodesFromDOM` and registered node converters for
JavaScriptCore, over `codegen/html-dom.ts`'s small DOM adapter. This keeps
converter priorities, equal-priority registration order and child conversions
in the web's own code. Unsupported DOM APIs throw naming #168; nodes whose
editing isn't ported throw naming their existing owning ticket. libxml2's
HTML4 nested-heading recovery is normalized to HTML5's heading closure.
Qualified tag names are protected during parsing: libxml2 otherwise turns
Word's unknown `o:p` elements into paragraphs, unlike the browser DOM.
RCDATA (`textarea`/`title`) preserves literal markup by escaping `<` until an
exact closing name with an HTML delimiter; entities still decode normally and
HTML's ignored self-closing flag is removed from those start tags. Foreign SVG
titles retain their HTML integration-point children; the scanner distinguishes
quoted attribute values from literal quotes inside unquoted values.

`bun run record:html` records clipboard-shaped Safari, Notes, Pages, Google
Docs and Word examples and seeded generated HTML with the independent bun
`@lexical/headless/dom` oracle. They contain synthetic public text, not captured
private clipboards. `HTMLPasteTests` replays those DOM conversions through the
public paste command and the existing serialized-node insertion path. Set
`HTML_FUZZ_SEED` and `HTML_FUZZ_CASES` when recording to replay another corpus.
It also exports and imports 200 documents from the command fuzzer's own node
`Generator`, including tables, tabs and links; regenerate those source samples
with `HTML_RECORD_NODE_SAMPLES=1 swift test --filter generatedHTMLAgreesWithDOMOracle`
before `bun run record:html`. Recorded HTML seeds 168 (500 cases), 2026 and 999
(2,000 each), plus those 200 node-generated documents, agree with the DOM oracle.
The JavaScriptCore command reference has no DOM parser; HTML therefore has
this separate oracle, and command fuzzing generates plain/serialized clipboard
content. Copy still writes plain text and Lexical JSON; HTML export is separate.

The additional `Lexical Word` fixture is an unchanged public Word clipboard
payload from Lexical v0.51.0, with its MIT license, pinned source and SHA-256 in
`Fixtures/HTML/upstream`. It failed the existing oracle replay before qualified
tag names were preserved. Disposable verification also replayed three captured
Google Docs inputs and Word/Word-through-Safari style inputs from CKEditor's
documented clipboard corpus, plus Lexical's verbatim VS Code-to-Safari payload.
Run `bun run verify:html-upstream` explicitly for repeatable verification of
those three Google Docs and two CKEditor Word payloads. It checks pinned input
bytes and SHA-256, requires the complete Bun-converted nodes to match the
frozen actual-Chromium canonical digest, and feeds temporary fixtures into the
existing public native paste replay. It removes all downloaded source payloads
afterward; default tests and CI never perform this network fetch. CKEditor
inputs are not vendored, and no fresh user Google Docs copy is claimed.
All agree with the browser DOM oracle; VS Code code nodes explicitly refuse
under #132. These are upstream captures, not newly captured on this device.
The seven upstream payloads, nine raw-text variants, SVG title and malformed
unquoted-attribute regressions also agree with actual
Chromium 152 `DOMParser` plus the unmodified web converters. Browser version,
input/output digests and verification results are in `chromium-verification.json`.
Captured Word's recorded expected nodes now come from that browser reference.
The retained malformed textarea regression was red against Chromium even though
libxml2 and Bun's DOM parser agreed; it prevents treating their shared recovery
error as browser parity. These bounded cases do not establish general HTML5
malformed-input recovery parity. Ordered-list start reflection also agrees
with sixteen actual Chromium cases: zero and negative values survive, invalid
values and values outside signed Int32 default to one, and only HTML ASCII
whitespace precedes the decimal prefix.
Actual disposable Safari, Pages and Notes clipboards were then copied by the
user and captured through a bounded, read-only native NSPasteboard helper.
Safari's original `public.html` is retained verbatim with its digest and frozen
Chromium converter output. Pages and Notes publish RTF/plain text, not HTML.
At the UIKit boundary, when Lexical JSON and HTML are absent, the OS's
`NSAttributedString` RTF reader and HTML writer normalize that RTF before the
same registered HTML converters run. Reader/writer failures explicitly refuse
with #168. Actual RTF fixtures and source-channel metadata are retained in
`TextKitEditorTests/Fixtures`: iOS tests were red before this normalization and
now preserve Pages' bold first paragraph and Notes' bold word, with both source
paragraphs and no trailing empty paragraph. The Notes sample also has a user
captured Safari `DataTransfer` HTML normalization and real Chromium oracle,
which agree with the iOS result. Its recorder's hard-coded Pages source label
was corrected from the actual Notes native type and text, with the original
recorder JSON digest retained. This browser-generated HTML is not represented
as original Pages or Notes HTML. Pages' native RTF is verified directly; no
Pages-to-Safari HTML capture is claimed.

## Native media

Images and inline images render stored raster sources; videos use AVKit.
ImageIO-supported GIF, APNG and WebP animations retain timed frames and loop
metadata. GIF delays below 20 ms use the browser’s 100 ms floor. Other source
delays remain intact. A uniform frame clock represents unequal timings with at
most 4096 references; timing sequences that cannot fit exactly are explicitly
refused rather than rounded. Cache cost counts each shared bitmap once. Block images animate in UIImageView; inline/table images redraw their
captioned attachments, pause outside the window and resume after relayout.
Decoding bounds the source, frame count and combined frame memory; images that
exceed those limits show an unavailable state instead of a first-frame fallback.

SVG media keeps its original URL/data and uses an authenticated server PNG
preview. The worker draws inert SVG image content into a bounded canvas, runs no
SVG scripts and permits no external resources. Original intrinsic dimensions
remain separate from downsampled preview pixels. SVGs rely on the worker's fonts
and the browser's image-context SVG support; malformed or oversized sources
remain explicitly unavailable. The app never turns the preview into stored PNG
media. This uses the existing render-worker secret/configuration and deployed
`POST /api/v1/embeds/rasterize-svg` and worker `/api/render/svg` routes. Standalone
TextKit clients must supply the explicit `NativeMediaImages.load(_:rasterizeSVG:)`
platform seam to support SVG; ordinary raster/animation loading is local.
YouTube, X and Figma use native LinkPresentation previews and open their official
URLs when tapped. Those previews do not reproduce provider iframe interaction;
a failed preview leaves an explicit unavailable card with its destination.
Figure sizing, viewport caps and caption measure are generated from the web CSS.
Rich captions reuse TextKit formatting and paragraph alignment; inline captions
are drawn into the attachment, retaining the original nested editor JSON.
The web currently stores inline-image `position` as a data attribute without a
layout rule, so native inline images likewise remain inline for every position.
Caption text font sizes share the native font/line-height implementation.
Unsupported caption node families (#134) and other CSS styles (#135) keep the
document read only.

The editor's insertion menu offers Photos and camera when uploading is available.
It checks current EDIT access before signing the JPEG upload and inserts its URL
only after PUT succeeds. Autosave then claims the uploaded image through the
existing document-save rule. The current document ID is read at upload time,
including after Keep Mine as a Copy. The camera action is disabled on simulators.

`MediaInsertionUITests/testPhotosSelectionInsertsOnlyUploadedImage` exercises the
real PHPicker with a simulator photo and a deterministic upload callback. Seed a
disposable image with `xcrun simctl addmedia <simulator> <picture>` if its photo
library is empty. The callback is enabled only by the harness launch environment
`EDITOR_IMAGE_UPLOAD_RETURN`; the shipping app always uses `Session.uploadImage`.

### Server-rendered document embeds (#132)

Mermaid, equations, charts and code blocks use authenticated
`POST /api/v1/embeds/render`. The worker opens `/native-render`, which runs
Lexidraw's existing Mermaid, KaTeX, Recharts and Shiki components with the
requested theme, document font and stored dimensions. The same browser element
produces an SVG containing styled XHTML in a `foreignObject` and a 2× PNG.
The native app displays that PNG and opens a native source editor on tap;
it does not execute web JavaScript or use WebKit to display these nodes.
Source Save is one document history step and participates in autosave. Cancel,
unchanged code source and unsupported replacement children preserve the original
node. Read-only source remains selectable for copying.

The endpoint caches both outputs under SHA-256 of the canonical node, theme,
width, font family/size and deployment revision. Each app process keeps at most
128 completed entries or 32 MB, with two renders active and twelve waiting.
Native requests run two at a time; inline and nested attachments start only when
TextKit lays out their block or cell. Errors remain visible and tapping a failed
embed retries while opening its source. Unknown node fields or unported children
retain the document's explicit read-only behavior.

SVG `foreignObject` needs browser XHTML support and the web's fonts; it is not a
portable path-only vector export. The PNG is the portable native preview of the
same element. Rendering requires `HEADLESS_RENDER_URL`,
`HEADLESS_RENDER_ENABLED=true`, a matching `RENDER_WORKER_SECRET` on both
services. Public app origins pass the worker’s public-address guard; private or
local origins need an explicit worker `RENDER_WORKER_ALLOWED_ORIGINS` entry.
Production uses `VERCEL_GIT_COMMIT_SHA` to invalidate renderer, CSS and bundled
font changes. Local cache tests may provide their own revision.

Local verification used eight real worker renders (all four families in light
and dark), an additional stored-size/caption chart, the Swift/Bun suites, a
simulator app build and six document-screen UI tests. Model oracle tests cover
code formatting, highlighted-text edits, copy/cut/paste around code, source
replacement/undo, rejected children, tabs and selected rules. Rendered source
editing on a physical device remains a release integration check. This work
does not close #119's performance or dictation gates.

## Social and reference nodes (#134)

Emoji shortcodes use the web's `EMOJI` markdown transformer and generated alias
table, producing ordinary Unicode text. Unknown aliases retain their text;
the shared markdown pipeline still splits it and moves selection like Lexical.
Imported table cells apply the same shortcode replacement, including its reset
of text formatting. The fuzzer generates known and unknown shortcodes and stored
normal-mode hashtag and keyword nodes, stored emoji tokens, and segmented mentions.

The main `document-editor.tsx` mounts `EmojiPickerPlugin` and markdown shortcuts,
but does not mount `MentionsPlugin`, `KeywordsPlugin`, `EmojisPlugin`, or
`HashtagPlugin`. Native main-editor typing follows that effective behavior:
it does not automatically turn mentions, hashtags, congratulations, or emoticons
into nodes. Hashtag transforms belong to the caption and slide editors that
actually mount that plugin. Stored normal-mode hashtags and keywords support native text
editing boundaries and splitting. They have no extra effective web color:
upstream `HashtagNode.createDOM` reads `theme.hashtag`, while the current theme
puts its unused hashtag class under `theme.text.hashtag`.

Polls render question, options, vote counts and rounded percentages in native
cards. Insert creates the web plugin's two empty options from generated constructor
JSON. Edit/remove/add and authenticated voting preserve option IDs and existing
votes, validate the captured node before replacement, and notify autosave once.
Undo restores the prior poll. The account identity comes from `auth.me`; its new
nullable name field remains compatible with older clients. Voting stays disabled
when identity is unavailable. Native option editing commits on the alert's Save.

Stored emoji tokens retain their payload and render their Unicode glyphs. Typing
inside a token replaces it, boundary typing redirects beside it, partial deletion
removes the whole token, and partial formatting preserves the token. The caption
renderer accepts hashtag, keyword, and emoji text leaves with supported styles.

Stored mentions support segmented typing/deletion and plain-text splitting,
preserving their mention name until Lexical converts them to ordinary text.
Their initial DOM background override is generated from `MentionNode.createDOM`.
The headless reference now includes Lexical's private `$removeSegment` helper;
native splitting and trimming use JavaScript whitespace and UTF-16 offsets.
Inherited transient DOM CSS updates are still a presentation gap: the native
renderer currently follows the node's persisted initial style.

Stored footnote references render as numbered superscript attachments. The first
root definition of each label supplies its number and plain preview; missing
labels show `label?`. Definition markers count every root definition, matching
the CSS counter, and have a native backlink to the first reference. The Notes
heading, localized titles, font sizes, indentation and spacing come from the
actual document CSS through codegen. Definitions use inherited ElementNode
Enter behavior, and imported table-cell markdown supports definitions/references;
typing a reference or definition does not invent a new shortcut. Definitions and
references preserve their stored labels and payloads through editing and undo.

Comment marks now follow the mounted CommentPlugin's boundary typing, paragraph
splitting, selection wrapping, nested-mark resolver, partial copy and unwrapping.
Comment/thread metadata markers remain inline in their stored paragraphs and
render invisibly without extra paragraph gaps. Native annotations preserve
nested highlights and thread resolution; readonly structural previews inherit
the owning document's thread resolution and footnote numbering.

The native Comments panel supports reading, selected-text comments, replies,
resolve/reopen, deleting threads/imported comments/replies, and navigation to the
first text anchor. Plain multiline content and author identity come from the
same stored payload; marker updates go through editor commands and autosave.
Reply/removal clones follow the web's current omission of `resolved`, including
its reopening behavior. Read-only documents expose the panel without edit
controls. An input whose web quote truncation would split a UTF-16 surrogate is
explicitly refused instead of storing a damaged quote. Generated defaults,
quote limits and annotation colors come from the current web source. Malformed
or unknown comment payload fields keep the document read-only.

Native article blocks preserve URL/distilled and saved-entity/snapshot payloads.
The saved-link picker uses authenticated extraction or the web's recent URL list
and search. Saved entities load the current distilled body, retaining the stored
snapshot when that body is absent or malformed; query failure stays visible.
Title, author, site, word count and local update time accompany the full body.
The guarded server render uses the same `ArticleContent` prose component as the
web, with eager images for complete capture. Body link hit regions and readable
accessibility text come from that DOM. Refresh, convert to editable text, and
confirmed removal use editor history and autosave; stale panels cannot overwrite
newer node data. Conversion unwraps the same top-level collapsible nodes and
selects beyond the same nearest collapsible ancestor before insertion.
HTML shapes the native importer cannot edit are explicitly refused rather than
silently converted to plain text.

Article bodies are native raster previews of the full sanitized web content,
not selectable browser DOM. Link taps open their browser destinations, and
VoiceOver reads the body as one text element; per-paragraph DOM navigation and
animated article media remain unported. The existing 16-megapixel render and
payload budgets apply, with a maximum link URL length of 8,192 characters.
Blocked/broken images retain the readable body. The clipboard/caption renderer's
broader CSS limits remain assigned to their owning tickets. Article generation
uses no AI. Real local authenticated light/dark render probes included headings,
bold/italic text, a public link, a table, a public GIF and a final paragraph;
a separate blocked-private-image probe proved the public request guard stayed
active while the article body remained readable.

This checkpoint does not complete #134. Non-normal keyword payloads retain their
explicit unported editing gate. Active caption/slide hashtag and keyword
transforms and unsupported social caption contexts still need work.
Stored social text generation opts in via `socialTextSubclasses`, preserving
fault-injection seeds; the full differential run enables it.

## Native structural blocks (#133)

Callouts, sections and columns use native panels for their previews and a native
TextKit editor sharing the parent model for body editing. Enter, arrows, deletion
and malformed-container repair therefore retain their actual parent context.
Page breaks remain selectable decorators. Sticky notes retain their inline model
identity, float at the stored offsets in editable wide documents, and sit in the
flow for compact/read-only documents, matching document.css. Their caption editor
uses PlainTextPlugin behavior: literal Markdown, line-break Enter, plain-text
paste/copy and no automatic links. Color, drag and deletion commit to the parent
history with the opened node as the conflict guard.

Slide decks render native text, images and presentation-only chart nodes through
the composed embed provider. Slide creation, deletion/reordering, element content,
geometry, background and stacking changes preserve the remaining deck metadata.
Slide text crosses the web's keyed-state boundary by stripping only live `key`
fields on load and restoring the native editor's live keys on save. Unknown node
fields and unported body nodes retain the existing explicit read-only/refusal path.

`codegen/structural-blocks.ts` records registered node factories, web insertion
presets, CSS theme colors and canvas geometry. The reference builder reuses the
actual CalloutPlugin, CollapsiblePlugin and LayoutPlugin implementations; its
bounded hook adapter supplies the active headless editor and runs registration
once. New hook/import shapes fail the bundle build rather than being omitted.
The web collapsible deletion handler now consumes deletion only when the previous
sibling is a section; it previously swallowed unrelated deletion at offset zero.

Opt in to structural documents in the existing differential fuzzer with
`FUZZ_STRUCTURAL=1 FUZZ_SEED=133 FUZZ_STEPS=20000 swift test --filter
FuzzerTests.lexicalSwiftMatchesTheReference`. Seeds 133 and 134 each agreed for
20,000 steps; eight discovered regressions are retained as frozen reference fixtures.
The rebased local UIKit suite passed 123 tests, including accepted structural-arrow autosave
and refusal to mutate a read-only document. CI was not invoked.

The native column panel accepts arbitrary positive fractional, pixel and percentage tracks and all five
registered presets, with column counting using the web plugin’s generated JavaScript
whitespace rule. Fixed tracks can scroll horizontally when they exceed the available width. Other CSS grid track grammars retain an explicit #133 limitation. Structural indent/outdent modifies
the effective Double value without truncating it. Collapsible parts and layout
items use the web's unread-field import rule: imported indent is retained in stored JSON while
the effective field starts at zero; a mutation writes the effective value. A
fractional effective value cannot be copied into integer-indented paragraph/list
schemas and explicitly refuses under #133. Read-only sections expand
locally without a document mutation; compact sticky notes cannot drag. Slide
inherited dimensions follow the canvas and text boxes grow to their content. Slide images currently
use HTTPS URLs and chart previews require the #132 composed provider. Geometry against the web's CSS and chart configuration/source UI still require
device-level verification. Slide geometry supports a native dialog plus direct dragging and four-corner
resizing. Gesture previews stay local and the completed gesture commits once
through the opened-node guard and history. Selection follows the element ID across
autosave rebuilds, so its resize handles remain active. The web’s numeric minimum
sizes are generated; inherited dimensions stay inherited when resizing. These are not claimed as
completed visual/performance gates.

Pure structural-panel documents expose their native controls as accessibility
containers. Mixed text/panel hosts preserve the original text input while exposing
visible native panel controls beside it. The retained slide
navigation UI regression was observed red against the original stored-ID behavior
and green with editable autosave and read-only local navigation. Slide chart
previews clear inherited root-node source callbacks and cached tap recognizers;
the deck's element editor owns the actual mutation.


The document and structural body/caption editor host lists the original UIKit
UITextInput beside its visible native panel containers for accessibility. Mixed
text and slide controls are reachable without substituting a text-input proxy;
the visible-view traversal does not serialize the document or scan its model.
The mixed-document regression was observed red at the missing slide button and
green after the host change. The gesture UI regression was observed red when an
autosave rebuild lost resize selection (the second drag moved without increasing
width), then green after retaining the selected element ID. These checks cover
actual app document-screen controls; broader VoiceOver narration and every nested
panel combination remain device verification work.


Fractional tracks whose factors total less than one leave the remaining free
space unused, following [CSS Grid’s fractional-track rule](https://www.w3.org/TR/css-grid-2/#fr-unit).
The landscape UI fixture `0.25fr 0.25fr` was observed red when each column occupied
half the row, then green with the unused half retained. Compact layout still
stacks those columns; track allocation applies only in wide layout.
The imported `100px 25% 0.5fr` fixture was observed red when its controls were
unavailable, then green with the pixel width preserved and percentage/fractional
tracks allocated separately. Fixed-track overflow uses a native horizontal viewport.

The follow-up rebased with SVG/animated media passed all 11 document-screen UI
tests, 93 Bun tests and TypeScript checks, and built the production app for the
iOS Simulator. The UI checks include mixed text accessibility, slide drag/resize
autosave, fixed/percentage tracks, partial fractional tracks and read-only slide
navigation. CI was not invoked.

### Native media insertion controls (#135)

The native insertion menu offers image Photos/camera actions, inline-image Photos,
the web toolbar GIF, and YouTube/Tweet/Figma URL dialogs. Constructor defaults,
URL patterns, capture indexes and YouTube ID length come from the actual web
sources through codegen. JavaScript word/digit classes are emitted as ASCII
ranges for Foundation regular expressions. GIF URLs resolve against the app's
configured server origin. Cancel leaves the document untouched.

Saving now claims owner-uploaded inline images and pictures in caption/slide
text editors through the existing signed-image validation and cleanup policy.
Video selection uses the system Photos picker, converts the chosen asset to MP4,
and inserts only after the signed transfer succeeds. The signing endpoint applies
the same document edit rule and upload records as the web, with a bounded token.
Inline-image insertion offers alternative text, position and caption controls;
position values, labels and initial payload come from the web dialog/constructor.
External embeds retain native link-preview behavior.

Imported column templates also support integer `repeat()` and `minmax()` with
pixel/percentage minima and fractional maxima, including zero-sized tracks.
Items beyond the explicit columns occupy subsequent rows. A Chromium DOM
reference confirmed the two-column, two-row layout for
`repeat(2, minmax(100px, 1fr))`; the production document-screen case was observed
red at missing column controls, then green. All 12 document UI tests passed
after the change. Content-sized tracks, automatic repeat and other CSS units
remain explicitly unsupported rather than flattened.

Structural panel bodies retain the live parent alignment, writing direction and
indent as presentation context instead of copying those fields into saved child
nodes. Callout bodies, section title/content and column bodies inherit the
context; list padding remains inside parent padding, and logical `start`/`end`
alignment resolves against each child's effective direction. Root document
metadata and composed drawing/media/rendered/social providers remain shared.
The native model reads effective element fields; the reference backend reads
the original Lexical getters for the same contract.

Three hosted production-panel regressions were observed failing before their
fixes: centered RTL parent context (`133-parent-preview-red2.xcresult`), parent
indent around a list (`133-parent-list-red.xcresult`), and RTL parent padding
with an LTR child (`133-parent-logical-red.xcresult`). The last case also follows
a Chromium CSS oracle with logical padding and inherited `text-align:start`.
Final local verification in `133-context-final.xcresult` passed 147 UIKit tests,
13 document UI tests and all three hosted panel tests. Swift package suites
passed 385 test methods; Bun passed 95 tests / 198 expectations, and reference
bundle generation and TypeScript checking passed. No CI was invoked.

Remaining #133 fidelity work includes intrinsic/auto
tracks, auto-repeat, fixed-maximum `minmax`, other CSS units/functions and named
lines. Those unsupported grid grammars retain their explicit limitation rather
than receiving guessed geometry. This checkpoint does not close #133.

The formatting context also includes every live ancestor prefix in the owning
model, including non-panel wrappers and the root. A hosted nested list →
list item → callout regression failed in `133-ancestor-red.xcresult` (the
preview caret stayed at x=0 despite inherited RTL/right formatting), then all
four hosted cases passed in `133-ancestor-green.xcresult` after the prefix fix.
The initial bare-grid oracle omitted production containment: `document.css`
sets column items to `min-width:0` and `container-type:inline-size`. Consequently
content (including a long unbreakable word) supplies no intrinsic track minimum.
The generated web border/padding box still contributes 18px for an occupied raw
fractional track. Tailwind's actual utilities and theme spacing generate those
values; unsupported source shapes fail code generation. Explicit fixed minima
keep their own track semantics and unoccupied fractional tracks have no box
contribution. Native editor controls do not participate in track sizing.

Column bodies keep the source box inset outside the nested editor. At a 100px
track, the source's 8px padding and 1px border leave an 82px content width, with
text starting 9px inside the column. RTL columns read effective live ancestor
direction, put the first column at inline-start and initially show inline-start
when fixed tracks overflow; subsequent manual scrolling is retained.

The box minimum, actual body inset and inherited RTL ordering were each
observed failing in hosted tests before their fixes (`133-box-red.xcresult`,
`133-column-padding-red.xcresult`, `133-columns-rtl-red.xcresult`). Browser
oracles used the production min-width, containment, padding and border styles,
including long text; bare-grid content minima are not claimed as app behavior.

Explicit zero/narrow tracks keep their declared grid positions while the actual
column border/padding box can overflow them, matching CSS box sizing. A hosted
`minmax(0,0fr) 1fr` case failed with a zero-width first box before the correction
(`133-column-overflow-red.xcresult`); the next track still starts at x=8 and
retains width 392 in a 400px grid.

The web insertion dialog exposes exactly five templates: `1fr 1fr`,
`1fr 3fr`, `1fr 1fr 1fr`, `1fr 2fr 1fr`, and `1fr 1fr 1fr 1fr`. All use the
common native fractional-track path. Additional imported templates can use the
implemented nonnegative px/%/fr, fixed-minimum/fractional-maximum `minmax`,
integer `repeat` and implicit-row subset. Arbitrary CSS strings are accepted by
the web node schema; auto/min/max-content, auto-repeat, fixed-maximum `minmax`,
fit-content, relative units/functions and named lines still explicitly refuse
under #133. No runtime JavaScript or WebKit layout boundary was added.

Local box/direction validation: `133-box-rtl-final.xcresult` passed 147 UIKit,
13 document UI and seven hosted tests. The explicit-zero overflow follow-up
then passed all eight hosted tests. After rebasing onto merged parent-preview
and video work, `133-box-integrated.xcresult` passed all eight hosted tests and
the three affected column UI tests; Bun passed 95 tests / 198 expectations,
TypeScript/code generation passed, and the production simulator app build
succeeded (`133-box-integrated-app.log`). No CI was invoked.

Column gap now comes from the actual `layoutContainer` Tailwind utility and
spacing theme. Editing columns draw the source's dashed, square-cornered
`border-muted` outline; read-only columns reserve the same border box with a
transparent stroke. The source declares no rounding. Muted light/dark colors
resolve through the existing build-time theme converter to native-readable
RGBA, since the runtime CSS color parser does not accept OKLCH. Theme changes
outside the supported gap/border/containment shape fail generation explicitly.

The hosted outline case failed because no CAShapeLayer border existed in
`133-column-style-red.xcresult`. Final `133-gap-style-final.xcresult` passed
all nine hosted cases and the three affected column UI tests; Bun passed
95 tests / 198 expectations, TypeScript passed, and the production simulator
app build succeeded (`133-gap-style-app.log`). Callout colors remain their
existing source HEX palette.

Sticky palettes now resolve their actual `@theme` and screen-only dark CSS
scopes through the existing build-time OKLCH converter to native RGBA. Unknown
palette scopes/formats fail generation. Native structural colors refuse
unsupported values explicitly with the owning #133 issue instead of becoming
invisible. Callout RGB and source tint resolve together for light/dark traits.
The registered sticky insertion genuinely failed alpha 0 versus 1 in
`133-sticky-color-red.xcresult`; the old callout opacity failed explicit dark
resolution at 0.08 versus 0.14 in `133-dark-explicit-red.xcresult`. Final
`133-sticky-green.xcresult` passed all 11 hosted cases and three affected column
UI tests. Bun passed 95 tests / 198 expectations, TypeScript/code generation
passed, and the production simulator app build passed (`133-sticky-app.log`).
No CI was invoked. Advanced imported grid grammar remains explicitly refused
until its separate native sizing implementation is verified.

The column utility adapter requires the exact known item class set (including
its generated padding utility); additions such as background, shadow or
opacity fail generation instead of being ignored. Native dashed strokes use a
conventional three-border-width dash/gap pattern; browser corner/dash phase
placement is not claimed to be pixel-identical.
