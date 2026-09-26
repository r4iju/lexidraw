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
