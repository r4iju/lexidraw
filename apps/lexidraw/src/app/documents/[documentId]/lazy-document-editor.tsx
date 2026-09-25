"use client";

import dynamic from "next/dynamic";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  Suspense,
  use,
} from "react";
import { loadKatex } from "~/lib/katex";
import { DocumentLoading } from "./document-loading";

type Props = ComponentProps<typeof import("./document-editor").default>;

// The editor's loading state shows what the page already knows, which
// `dynamic` does not pass it.
const Opening = createContext<Pick<
  Props,
  "entity" | "frame" | "renderMode"
> | null>(null);

function EditorLoading() {
  const opening = use(Opening);
  // A renderer waits for the document itself; it has no one to reassure.
  if (opening?.renderMode && opening.renderMode !== "view") return null;
  return <DocumentLoading entity={opening?.entity} frame={opening?.frame} />;
}

const Editor = dynamic(() => import("./document-editor"), {
  ssr: false,
  loading: EditorLoading,
});

let equations: Promise<unknown> | undefined;

/**
 * What a document's blocks need to draw at their size the first time: KaTeX,
 * its stylesheet and its two commonest fonts, for a document with an
 * equation. They load alongside the editor; a document without one never
 * asks for them. The editor opens even when they fail to load, and each
 * equation shows its TeX instead.
 */
function blocksReady(elements: string | null) {
  if (typeof window === "undefined") return null;
  if (!elements?.includes('"type":"equation"')) return null;
  equations ??= loadKatex()
    .then(() =>
      Promise.all([
        document.fonts.load("1em KaTeX_Main"),
        document.fonts.load("italic 1em KaTeX_Math"),
      ]),
    )
    .catch(() => undefined);
  return equations;
}

function BlocksReady({
  elements,
  children,
}: {
  elements: string | null;
  children: ReactNode;
}) {
  const ready = blocksReady(elements);
  if (ready) use(ready);
  return children;
}

export default function DocumentEditor(props: Props) {
  return (
    <Opening
      value={{
        entity: props.entity,
        frame: props.frame,
        renderMode: props.renderMode,
      }}
    >
      <Suspense fallback={<EditorLoading />}>
        <BlocksReady elements={props.entity.elements}>
          <Editor {...props} />
        </BlocksReady>
      </Suspense>
    </Opening>
  );
}
