import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AudioPlayerProps } from "../../components/ui/audio-player";
import { projectSavedRecording } from "./saved-recording";
const sources: AudioPlayerProps[] = [];
mock.module("~/components/ui/audio-player", () => ({
  AudioPlayer: (props: AudioPlayerProps) => {
    sources.push(props);
    return <span data-source={props.src} />;
  },
}));
const { SavedRecordingPlayback } = await import(
  "../../app/documents/[documentId]/plugins/SavedRecordingPlayback"
);
import { createClient } from "@libsql/client/sqlite3";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../../packages/drizzle/tests/fixtures/conversion-modern-v1/store-schema.js";
import { drizzleDocumentStore } from "../../server/documents/document-store";
import { convertLegacyDocuments } from "../../../../../packages/drizzle/src/migrations/legacy-document-conversion.js";
import {
  batch,
  database,
  immutable,
  payload,
  state,
} from "../../../../../packages/drizzle/tests/fixtures/conversion-modern-v1/database.js";
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, $isTextNode } from "lexical";
import { CORE_NODES } from "@packages/lexical-nodes/nodes";
const suffix =
  ',"tts":{"text":"Legacy hello","audioUrl":"https://example.invalid/saved.mp3"},"unknown":{"retain":"\\u2603","number":1.00}}\n';
function editor(raw: string, text: string) {
  const e = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error: Error) => {
      throw error;
    },
  });
  e.setEditorState(e.parseEditorState(raw));
  expect(e.getEditorState().read(() => $getRoot().getTextContent())).toBe(text);
  return e;
}

test("modern converted content fully reopens with tags after two actual headless edits and actual store saves", async () => {
  const db = await database();
  const queries: string[] = [];
  const projections = [];
  const markups: string[] = [];
  sources.length = 0;
  try {
    expect(
      await db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).toEqual({ documents: 1, shares: 1, repeated: false });
    const retained = await immutable(db.client);
    const store = drizzleDocumentStore(
      drizzle(db.client, {
        schema,
        logger: {
          logQuery(q) {
            queries.push(q);
          },
        },
      }),
      "owner",
      undefined,
      { prepareRoot: async (root) => root },
    );
    let current = await store.read("conversion-doc-v1");
    expect(current).not.toBeNull();
    if (!current) throw Error("missing persisted document");
    expect(current.elements).toBe(payload);
    expect(current.tags).toEqual([]);
    let previousText = "Legacy hello";
    let previousRevision = current.updatedAt.getTime();
    for (const [index, text] of [
      "First actual edit",
      "Second actual edit",
    ].entries()) {
      const e = editor(current.elements, previousText);
      e.update(
        () => {
          const node = $getRoot().getAllTextNodes()[0];
          if (!$isTextNode(node)) throw Error("missing literal text");
          node.setTextContent(text);
        },
        { discrete: true },
      );
      const incoming = JSON.stringify(e.getEditorState());
      const result = await store.write(
        "conversion-doc-v1",
        {
          elements: incoming,
          title: `Edit ${index + 1}`,
          tags: index === 0 ? ["Zulu", "Alpha"] : ["Beta", "Alpha"],
        },
        current.updatedAt,
      );
      expect(result).not.toBeNull();
      if (!result) throw Error("missing saved revision");
      expect(result.updatedAt.getTime()).toBeGreaterThan(previousRevision);
      const fresh = createClient({ url: db.url });
      try {
        const reopen = drizzleDocumentStore(
          drizzle(fresh, {
            schema,
            logger: {
              logQuery(q) {
                queries.push(q);
              },
            },
          }),
          "owner",
          undefined,
          { prepareRoot: async (root) => root },
        );
        current = await reopen.read("conversion-doc-v1");
        expect(current).not.toBeNull();
        if (!current) throw Error("missing persisted document");
        expect(current.updatedAt).toEqual(result.updatedAt);
        expect(current.title).toBe(`Edit ${index + 1}`);
        expect(current.tags).toEqual(
          index === 0 ? ["Alpha", "Zulu"] : ["Alpha", "Beta"],
        );
        expect(current.elements.startsWith('  {"root":')).toBe(true);
        expect(current.elements.endsWith(suffix)).toBe(true);
        editor(current.elements, text);
        const projection = projectSavedRecording(
          new TextEncoder().encode(current.elements),
          "text",
        );
        projections.push(projection);
        markups.push(
          renderToStaticMarkup(
            <SavedRecordingPlayback
              documentId="conversion-doc-v1"
              screen={projection}
            />,
          ),
        );
        expect(await immutable(fresh)).toEqual(retained);
      } finally {
        fresh.close();
      }
      previousText = text;
      previousRevision = current.updatedAt.getTime();
    }
    expect(projections).toEqual(
      [1, 2].map(() => ({
        kind: "saved-recording",
        text: "Legacy hello",
        audioUrl: "https://example.invalid/saved.mp3",
      })),
    );
    expect(sources).toEqual(
      [1, 2].map(() => ({
        src: "https://example.invalid/saved.mp3",
        autoPlay: false,
        className: "min-w-xs",
      })),
    );
    for (const markup of markups) {
      expect(markup).toContain("Legacy hello");
      expect(markup).toContain("Existing saved recording");
      expect(markup).not.toContain("could not be read safely");
    }
    expect(
      queries.filter((q) => q.includes('inner join "Tags"')).length,
    ).toBeGreaterThanOrEqual(3);
    const before = await state(db.client);
    expect(
      await db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).toEqual({ documents: 1, shares: 1, repeated: true });
    expect(await state(db.client)).toEqual(before);
    expect(await immutable(db.client)).toEqual(retained);
    expect((await store.read("conversion-doc-v1"))?.elements).toBe(
      current.elements,
    );
  } finally {
    await db.close();
  }
});
