/// <reference types="bun" />
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { JSDOM } from "jsdom";
import type { Klass, LexicalEditor, LexicalNode } from "lexical";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setScreen } from "~/test/dom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/documents/1",
  pretendToBeVisual: true,
});
const globals = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
const replaced = [
  "window",
  "document",
  "navigator",
  "Event",
  "CustomEvent",
  "AbortController",
  "AbortSignal",
  "localStorage",
] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);
let shimmed: string[] = [];

mock.module("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
// Menus close when the route changes; there is no route here.
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

type Modules = {
  LexicalComposer: typeof import("@lexical/react/LexicalComposer").LexicalComposer;
  RichTextPlugin: typeof import("@lexical/react/LexicalRichTextPlugin").RichTextPlugin;
  ContentEditable: typeof import("@lexical/react/LexicalContentEditable").ContentEditable;
  LexicalErrorBoundary: typeof import("@lexical/react/LexicalErrorBoundary").LexicalErrorBoundary;
  useLexicalComposerContext: typeof import("@lexical/react/LexicalComposerContext").useLexicalComposerContext;
  comments: typeof import(".");
  nodes: Klass<LexicalNode>[];
};
let m: Modules;

beforeAll(async () => {
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  for (const key of replaced) globals[key] = win[key];
  globals.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  setScreen({ width: 1280 });
  const { CORE_NODES } = await import("@packages/lexical-nodes");
  m = {
    LexicalComposer: (await import("@lexical/react/LexicalComposer"))
      .LexicalComposer,
    RichTextPlugin: (await import("@lexical/react/LexicalRichTextPlugin"))
      .RichTextPlugin,
    ContentEditable: (await import("@lexical/react/LexicalContentEditable"))
      .ContentEditable,
    LexicalErrorBoundary: (await import("@lexical/react/LexicalErrorBoundary"))
      .LexicalErrorBoundary,
    useLexicalComposerContext: (
      await import("@lexical/react/LexicalComposerContext")
    ).useLexicalComposerContext,
    comments: await import("."),
    nodes: [
      ...CORE_NODES,
      (await import("../../nodes/CommentNode")).CommentNode,
      (await import("../../nodes/ThreadNode")).ThreadNode,
    ],
  };
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
  delete globals.ResizeObserver;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

const COMMENT = {
  author: "Reviewer",
  content: "Check the Japanese spacing",
  deleted: false,
  id: "comment-1",
  timeStamp: 0,
  type: "comment",
} as const;

/** One commented range, and the thread that holds its single comment. */
const COMMENTED = JSON.stringify({
  root: {
    type: "root",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children: [
      {
        type: "paragraph",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        children: [
          {
            type: "mark",
            version: 1,
            direction: null,
            format: "",
            indent: 0,
            ids: ["thread-1"],
            children: [
              {
                type: "text",
                version: 1,
                text: "Commented text",
                format: 0,
                detail: 0,
                mode: "normal",
                style: "",
              },
            ],
          },
        ],
      },
      {
        type: "thread",
        version: 1,
        format: 0,
        indent: 0,
        direction: null,
        children: [],
        thread: {
          id: "thread-1",
          quote: "Commented text",
          type: "thread",
          comments: [COMMENT],
        },
      },
    ],
  },
});

let editor: LexicalEditor;
let plugin: ReturnType<Modules["comments"]["useCommentPlugin"]>;

function Capture() {
  [editor] = m.useLexicalComposerContext();
  plugin = m.comments.useCommentPlugin();
  return null;
}

function Document({ state }: { state: string }) {
  const { LexicalComposer, RichTextPlugin, ContentEditable } = m;
  const { CommentPluginProvider, CommentUI } = m.comments;
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "test",
        editorState: state,
        nodes: m.nodes,
        onError: (error: Error) => {
          throw error;
        },
      }}
    >
      <CommentPluginProvider>
        <RichTextPlugin
          contentEditable={<ContentEditable id="content" />}
          ErrorBoundary={m.LexicalErrorBoundary}
        />
        <Capture />
        <CommentUI />
      </CommentPluginProvider>
    </LexicalComposer>
  );
}

const mounted: Root[] = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  dom.window.document.body.replaceChildren();
});

async function open(state: string): Promise<Root> {
  const root = createRoot(
    dom.window.document.body.appendChild(
      dom.window.document.createElement("div"),
    ),
  );
  mounted.push(root);
  await act(async () => root.render(<Document state={state} />));
  return root;
}

/** Every comment the panel lists, inside threads or on their own. */
function listedComments() {
  return plugin.comments.flatMap((item) =>
    item.type === "thread" ? item.comments : [item],
  );
}

/** Every comment the document itself stores. */
function storedComments(state: string) {
  type Stored = {
    type: string;
    thread?: { comments: unknown[] };
    children?: Stored[];
  };
  const walk = (node: Stored): unknown[] =>
    node.type === "thread"
      ? (node.thread?.comments ?? [])
      : (node.children ?? []).flatMap(walk);
  return walk((JSON.parse(state) as { root: Stored }).root);
}

describe("comments on a document", () => {
  test("appear once after saving and reloading, however often", async () => {
    let state = COMMENTED;
    for (let visit = 0; visit < 3; visit++) {
      const root = await open(state);
      expect(listedComments().map((comment) => comment.id)).toEqual([
        "comment-1",
      ]);
      state = JSON.stringify(editor.getEditorState());
      expect(storedComments(state)).toHaveLength(1);
      await act(async () => root.unmount());
      mounted.splice(mounted.indexOf(root), 1);
    }
  });

  test("adding a comment that is already there changes nothing", async () => {
    await open(COMMENTED);
    const [thread] = plugin.comments;
    if (thread?.type !== "thread") throw new Error("Missing thread");
    await act(async () => {
      plugin.commentStore.addComment(thread);
      plugin.commentStore.addComment({ ...COMMENT }, thread);
    });
    expect(plugin.comments).toHaveLength(1);
    expect(listedComments()).toHaveLength(1);
  });

  test("a thread opens showing its first comment and who wrote it", async () => {
    await open(COMMENTED);
    const panel = dom.window.document.querySelector(
      "[data-component-name='CommentUI']",
    );
    expect(panel?.textContent).toContain(COMMENT.content);
    expect(panel?.textContent).toContain(COMMENT.author);
  });

  test("with none yet, the panel says how to add one", async () => {
    await open(
      JSON.stringify({
        root: {
          ...JSON.parse(COMMENTED).root,
          children: [JSON.parse(COMMENTED).root.children[0]],
        },
      }),
    );
    const panel = dom.window.document.querySelector(
      "[data-component-name='CommentUI']",
    );
    expect(panel?.textContent).toContain(
      "Select text and press the comment button",
    );
  });
});
