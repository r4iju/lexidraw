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
import { AccessLevel } from "@packages/types";
import { JSDOM } from "jsdom";
import type { Klass, LexicalEditor, LexicalNode } from "lexical";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

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
] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);
let shimmed: string[] = [];

// A poll counts votes by who is reading; the session behind that is not
// what is under test.
mock.module("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

type Modules = {
  LexicalComposer: typeof import("@lexical/react/LexicalComposer").LexicalComposer;
  RichTextPlugin: typeof import("@lexical/react/LexicalRichTextPlugin").RichTextPlugin;
  ContentEditable: typeof import("@lexical/react/LexicalContentEditable").ContentEditable;
  LexicalErrorBoundary: typeof import("@lexical/react/LexicalErrorBoundary").LexicalErrorBoundary;
  useLexicalComposerContext: typeof import("@lexical/react/LexicalComposerContext").useLexicalComposerContext;
  editability: typeof import("./editability");
  nodes: Klass<LexicalNode>[];
  chart: typeof import("./plugins/ChartPlugin");
  mermaid: typeof import("./plugins/MermaidPlugin");
  tables: typeof import("./plugins/DocumentTablesPlugin");
  resizer: typeof import("./plugins/TableCellResizer");
  markdown: typeof import("~/server/documents/markdown");
  edits: typeof import("./lexical-edits");
  markdownTools: typeof import("./utils/markdown");
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
    editability: await import("./editability"),
    chart: await import("./plugins/ChartPlugin"),
    mermaid: await import("./plugins/MermaidPlugin"),
    tables: await import("./plugins/DocumentTablesPlugin"),
    resizer: await import("./plugins/TableCellResizer"),
    markdown: await import("~/server/documents/markdown"),
    edits: await import("./lexical-edits"),
    markdownTools: await import("./utils/markdown"),
    // As the document editor registers them: the React halves after the core
    // set, so each type resolves to the class that has a component.
    nodes: [
      ...CORE_NODES,
      (await import("./nodes/PageBreakNode")).PageBreakNode,
      (await import("./nodes/PollNode")).PollNode,
      (await import("./nodes/TweetNode")).TweetNode,
      (await import("./nodes/StickyNode")).StickyNode,
    ],
  };
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
  delete globals.ResizeObserver;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

const EMPTY_ROOT = {
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
      children: [],
    },
  ],
};

/** A page break, a poll and a sticky note: blocks that carry their own controls. */
const BLOCKS = JSON.stringify({
  root: {
    ...EMPTY_ROOT,
    children: [
      { type: "page-break", version: 1 },
      {
        type: "poll",
        version: 1,
        question: "Lunch?",
        options: [
          { text: "Ramen", uid: "a", votes: [] },
          { text: "Soba", uid: "b", votes: ["someone"] },
        ],
      },
      {
        ...EMPTY_ROOT.children[0],
        children: [
          {
            type: "sticky",
            version: 1,
            color: "yellow",
            xOffset: 0,
            yOffset: 0,
            caption: { editorState: { root: EMPTY_ROOT } },
          },
        ],
      },
    ],
  },
});

let captured: LexicalEditor | null = null;
let markdownTools: ReturnType<Modules["markdownTools"]["useMarkdownTools"]>;

function Capture() {
  const [editor] = m.useLexicalComposerContext();
  captured = editor;
  markdownTools = m.markdownTools.useMarkdownTools();
  return null;
}

/** The document editor's frame around a stored state, as a reader or an editor opens it. */
function Document({
  state,
  editable,
  tables = false,
}: {
  state: string;
  editable: boolean;
  tables?: boolean;
}) {
  const { LexicalComposer, RichTextPlugin, ContentEditable } = m;
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "test",
        editorState: state,
        editable,
        nodes: m.nodes,
        onError: (error: Error) => {
          throw error;
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable id="content" />}
        ErrorBoundary={m.LexicalErrorBoundary}
      />
      <m.editability.EditabilityPlugin editable={editable} />
      <Capture />
      <m.chart.default />
      <m.mermaid.default />
      {tables && (
        <>
          <m.tables.DocumentTablesPlugin />
          <m.resizer.default />
        </>
      )}
    </LexicalComposer>
  );
}

const mounted: Root[] = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  dom.window.document.body.replaceChildren();
});

async function mount(element: React.ReactElement): Promise<Root> {
  const root = createRoot(
    dom.window.document.body.appendChild(
      dom.window.document.createElement("div"),
    ),
  );
  mounted.push(root);
  await act(async () => root.render(element));
  // The block components load lazily; let their chunks and effects settle.
  for (let i = 0; i < 5; i++) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  return root;
}

/** Everything a reader could click, type into or tick, anywhere on the page. */
function controls(): Element[] {
  return [
    ...dom.window.document.body.querySelectorAll(
      "button, input, textarea, select, [role='checkbox'], [role='button']",
    ),
  ];
}

function contentEditable(): string | null | undefined {
  return dom.window.document
    .getElementById("content")
    ?.getAttribute("contenteditable");
}

describe("who may edit a document", () => {
  test("only someone with edit access, and only when it is on screen to edit", () => {
    const { mayEdit } = m.editability;
    expect(mayEdit("view", AccessLevel.EDIT)).toBe(true);
    expect(mayEdit("view", AccessLevel.READ)).toBe(false);
    expect(mayEdit("print", AccessLevel.EDIT)).toBe(false);
    expect(mayEdit("screenshot", AccessLevel.EDIT)).toBe(false);
  });
});

describe("a document opened for reading", () => {
  test("takes no typing", async () => {
    await mount(
      <Document
        state={JSON.stringify({ root: EMPTY_ROOT })}
        editable={false}
      />,
    );
    expect(contentEditable()).toBe("false");
  });

  test("stays read-only when a block asks for editing back", async () => {
    await mount(
      <Document
        state={JSON.stringify({ root: EMPTY_ROOT })}
        editable={false}
      />,
    );
    await act(async () => captured?.setEditable(true));
    expect(captured?.isEditable()).toBe(false);
    expect(contentEditable()).toBe("false");
  });

  test("shows its blocks without their editing controls", async () => {
    await mount(<Document state={BLOCKS} editable={false} />);
    const text = dom.window.document.body.textContent ?? "";
    expect(text).toContain("Lunch?");
    expect(text).toContain("Ramen");
    expect(text).toContain("Soba");
    expect(text).not.toMatch(/PAGE\s*BREAK/);
    expect(text).not.toContain("Add Option");
    expect(controls().map((element) => element.outerHTML)).toEqual([]);
  });
});

describe("a document opened for editing", () => {
  test("offers its blocks' editing controls", async () => {
    await mount(<Document state={BLOCKS} editable />);
    expect(contentEditable()).toBe("true");
    expect(dom.window.document.body.textContent).toContain("Add Option");
    expect(controls().length).toBeGreaterThan(0);
  });

  test("switches to reading and back", async () => {
    const state = JSON.stringify({ root: EMPTY_ROOT });
    const root = await mount(<Document state={state} editable />);
    expect(contentEditable()).toBe("true");
    await act(async () =>
      root.render(<Document state={state} editable={false} />),
    );
    expect(contentEditable()).toBe("false");
    await act(async () => root.render(<Document state={state} editable />));
    expect(contentEditable()).toBe("true");
  });
});

test("opening tables in the editor preserves the stored state and produces no local edit", async () => {
  const state = JSON.stringify(
    m.markdown.markdownToEditorState(
      "| Name | Cost |\n| --- | --- |\n| claude-dev | 20% |",
    ),
  );
  const root = await mount(<Document state={state} editable />);
  if (!captured) throw new Error("Editor not mounted");
  const edits = m.edits.trackLexicalEdits(captured);
  await act(async () =>
    root.render(<Document state={state} editable tables />),
  );
  expect(edits.hasLocalEdits()).toBe(false);
  expect(JSON.stringify(captured.getEditorState().toJSON())).toBe(state);
  edits.dispose();
});

test("replacing markdown in the app keeps a person's column widths", async () => {
  const md = "| Name | Cost |\n| --- | --- |\n| claude-dev | 20% |";
  const state = m.markdown.markdownToEditorState(md);
  const table = state.root.children[0];
  if (!table) throw new Error("Expected table");
  Object.assign(table, { colWidths: [240, 480] });
  await mount(<Document state={JSON.stringify(state)} editable />);
  if (!captured) throw new Error("Editor not mounted");
  const editor = captured;
  await act(async () =>
    markdownTools.insertMarkdown(editor, md.replace("20%", "30%"), "replace", {
      title: "Tables",
    }),
  );
  expect(editor.getEditorState().toJSON().root.children[0]).toHaveProperty(
    "colWidths",
    [240, 480],
  );
});

test("reading a poll shows counts, percentages and total, including zero votes", async () => {
  await mount(<Document state={BLOCKS} editable={false} />);
  const text = dom.window.document.body.textContent;
  expect(text).toContain("0 votes · 0%");
  expect(text).toContain("1 vote · 100%");
  expect(text).toContain("1 vote total");
  expect(dom.window.document.querySelectorAll("meter").length).toBe(2);
});

for (const kind of ["chart", "mermaid"] as const) {
  test(`inserting ${kind} after the current paragraph creates a separate block`, async () => {
    const state = m.markdown.markdownToEditorState(
      "Before insertion.\n\nFollowing paragraph.",
    );
    await mount(<Document state={JSON.stringify(state)} editable />);
    if (!captured) throw new Error("Editor not mounted");
    const editor = captured;
    const { $getRoot, $isElementNode } = await import("lexical");
    await act(async () => {
      editor.update(
        () => {
          const first = $getRoot().getFirstChild();
          if ($isElementNode(first)) first.selectStart();
          if (kind === "chart")
            editor.dispatchCommand(m.chart.INSERT_CHART_COMMAND, {});
          else
            editor.dispatchCommand(m.mermaid.INSERT_MERMAID_COMMAND, undefined);
        },
        { discrete: true },
      );
    });
    const children = editor.getEditorState().toJSON().root.children;
    expect(children.map((child) => child.type)).toEqual([
      "paragraph",
      kind,
      "paragraph",
    ]);
    expect(
      editor
        .getEditorState()
        .read(() => $getRoot().getFirstChild()?.getTextContent()),
    ).toBe("Before insertion.");
  });
}

test("a tweet requests a readable theme from its widget provider", async () => {
  const widget = dom.window.document.createElement("iframe");
  widget.title = "Tweet";
  Object.assign(dom.window, {
    twttr: {
      widgets: {
        createTweet: async (
          _id: string,
          container: HTMLElement,
          options?: { theme: string },
        ) => {
          widget.setAttribute(
            "aria-label",
            options?.theme === "light" ? "Readable tweet" : "Missing theme",
          );
          container.append(widget);
        },
      },
    },
  });
  await mount(
    <Document
      state={JSON.stringify({
        root: {
          ...EMPTY_ROOT,
          children: [{ type: "tweet", version: 1, id: "123", format: "" }],
        },
      })}
      editable={false}
    />,
  );
  await act(async () => {
    dom.window.document
      .querySelector('script[src="https://platform.twitter.com/widgets.js"]')
      ?.dispatchEvent(new dom.window.Event("load"));
  });
  expect(widget.getAttribute("aria-label")).toBe("Readable tweet");
  delete (dom.window as unknown as { twttr?: unknown }).twttr;
});
