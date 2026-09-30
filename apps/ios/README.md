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
- Documents aren't saved yet, so the save messages that name the file and say
  what to do next belong to #130, which brings document editing.
- Until saving comes, documents open in the editor as a preview: edits work,
  and a notice above the document says they aren't saved. A document the
  user may only read says so instead, and brings up no keyboard, but its
  text can be selected and copied. So does one with a node LexicalSwift
  doesn't edit yet, and the notice says why.
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
- ⌘⌥0 to ⌘⌥3 and ⌘⌥Q set the block type from a hardware keyboard, the web's
  shortcuts. The app has no block menu yet. Headings 4 to 6 come only from
  typing `####` to `######`, as on the web, where #135 owns the block menu.
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
HTML's ignored self-closing flag is removed from those start tags.

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
All agree with the browser DOM oracle; VS Code code nodes explicitly refuse
under #132. These are upstream captures, not newly captured on this device.
The seven upstream payloads and nine raw-text variants also agree with actual
Chromium 152 `DOMParser` plus the unmodified web converters. Browser version,
input/output digests and verification results are in `chromium-verification.json`.
Captured Word's recorded expected nodes now come from that browser reference.
The retained malformed textarea regression was red against Chromium even though
libxml2 and Bun's DOM parser agreed; it prevents treating their shared recovery
error as browser parity. These bounded cases do not establish general HTML5
malformed-input recovery parity.
Actual Pages and Notes clipboard fixtures remain unverified, as does a fresh
Safari webpage capture; synthetic app-shaped examples do not close those gaps.
