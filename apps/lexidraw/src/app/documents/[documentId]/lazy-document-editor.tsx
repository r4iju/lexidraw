"use client";

import dynamic from "next/dynamic";
import { type ComponentProps, createContext, use } from "react";
import { DocumentLoading } from "./document-loading";

type Props = ComponentProps<typeof import("./document-editor").default>;

// The editor's loading state shows what the page already knows, which
// `dynamic` does not pass it.
const Opening = createContext<Pick<
  Props,
  "entity" | "frame" | "renderMode"
> | null>(null);

const Editor = dynamic(() => import("./document-editor"), {
  ssr: false,
  loading: function EditorLoading() {
    const opening = use(Opening);
    // A renderer waits for the document itself; it has no one to reassure.
    if (opening?.renderMode && opening.renderMode !== "view") return null;
    return <DocumentLoading entity={opening?.entity} frame={opening?.frame} />;
  },
});

export default function DocumentEditor(props: Props) {
  return (
    <Opening
      value={{
        entity: props.entity,
        frame: props.frame,
        renderMode: props.renderMode,
      }}
    >
      <Editor {...props} />
    </Opening>
  );
}
