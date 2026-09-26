# Upgrading Lexical

Stored documents are Lexical JSON, and three things read them: the web
editor, the server's headless editor, and LexicalSwift on iOS. The contract
between them is `packages/lexical-nodes/node-schema.json`, which is exported
from the nodes' `$config` declarations. LexicalSwift's node types are
generated from that file. LexicalSwift's editing is checked against real
Lexical by a differential fuzzer.

An upgrade is: bump, regenerate, then port the diff until the fuzzer passes.

## 1. Bump

Move `lexical` and every `@lexical/*` package to the same version in
`packages/lexical-nodes`, `apps/lexidraw` and `apps/ios`, then:

```sh
bun install
bunx turbo run build --filter='./packages/*'
```

## 2. Regenerate

```sh
cd packages/lexical-nodes && bun run node-schema
cd apps/ios && bun run codegen
```

The exporter fails on a registered node that doesn't declare its JSON through
`$config`. That includes a node Lexical newly registers in every editor. Declare
the node; don't skip it.

`git diff packages/lexical-nodes/node-schema.json` shows what the new Lexical
changed in the stored format: a field added, a default moved, a new value kind.

If codegen throws on something it can't describe, such as a new kind or two
types that would share a name, extend `apps/ios/codegen/swift.ts` with a test
in `swift.test.ts`. Don't hand-edit `SerializedNodes.swift`.

## 3. Port the diff until the fuzzer passes

```sh
cd packages/lexical-nodes && bun test
cd apps/ios && FUZZ_STEPS=20000 bun run test
bun run test:ts && bun run test
```

A failure in `stored-bytes.test.ts`, `stored-json.test.ts` or
`StoredBytesTests` means a stored document no longer saves as it did: see
[Stored bytes](#stored-bytes).

`bun run test` in `apps/ios` rebuilds the JS reference from the new Lexical,
then runs the Swift tests against it:

- **`SerializedNodeTests`** reads `packages/lexical-nodes/test/every-node.json`.
  That document holds every node type (a test on each side checks this) and
  must round-trip unchanged through Lexical and through the generated types.
  Its `OddValue` cases plant out-of-domain values and expect LexicalSwift to
  read them as Lexical does. Port a new schema kind to `FieldSchema.swift` and
  a new named transform to `Transforms.swift`.
- **`FixtureReplayTests`** replays the committed fixtures in
  `Tests/LexicalSwiftTests/Fixtures`.
  - When `theReferenceStillAgrees` fails, Lexical changed behaviour that a
    fixture pins. Re-record the fixture's `changes` and `expected` from the new
    reference (`Fixture.record`), then port the change to LexicalSwift.
  - When `lexicalSwiftMatchesTheRecordedReference` fails, LexicalSwift still
    behaves the old way.
- **`lexicalSwiftMatchesTheReference`** fuzzes LexicalSwift against the
  reference. Each divergence it finds is written as a shrunk
  `Fixtures/fuzz-*.json`. Fix LexicalSwift until the fixture replays green, give
  the fixture a name that says what it pins, and commit it. `FUZZ_SEED`
  replays a reported seed.

The upgrade is done when all of these pass with a few different seeds.

## Stored bytes

`packages/lexical-nodes/test/stored-bytes.json` pins the bytes a stored
document saves as. Each case is one stored node in a minimal document, as
stored or with one property removed, reordered or given an odd value. With it
is what the nodes saved for that document before they declared their schemas:
commit 627e6f83 (`emanuel/110-node-schemas`) on Lexical 0.51.0, loaded and
saved headless. `output` is left out where the save is the node as stored.
`threw` marks a node those nodes couldn't read.

It is a frozen record of that implementation. Nothing regenerates it from the
current code, which would only make it agree with whatever the code does. It
holds two changes accepted since: a slide deck's default box is
`default-box-1`, and the 20 image, inline-image and sticky cases that threw
now load.

Three tests hold to it:

- `stored-bytes.test.ts` in `packages/lexical-nodes`: the package's nodes save
  each case as recorded.
- `stored-json.test.ts` in `apps/lexidraw`: so do the web editor's nodes.
- `StoredBytesTests` in `apps/ios`: LexicalSwift's editor loads and saves each
  case as recorded, but for the properties a node doesn't declare, which it
  keeps. The web opens LexicalSwift's save as it opens the original.

When a Lexical bump makes it fail:

1. List the cases that save differently, with both saves:

   ```sh
   cd packages/lexical-nodes && bun run stored-bytes
   ```

2. Decide whose change each one is.
   - **Lexical's**: Lexical's own nodes (root, paragraph, text) change the same
     way, or its changelog says so. Every stored document changes with the
     upgrade, so record the new save for exactly those cases, and name the
     Lexical change in the commit:

     ```sh
     bun run stored-bytes --rerecord "<case name>" "<case name>"
     ```

   - **A node's**: its schema reads or writes a property differently than it
     did. Fix the node's `$config` and keep the record.
3. Run `bun test` in `packages/lexical-nodes` and `apps/lexidraw`. Then run
   `bun run codegen && bun run test` in `apps/ios`, and port the change to
   LexicalSwift until `StoredBytesTests` passes.
