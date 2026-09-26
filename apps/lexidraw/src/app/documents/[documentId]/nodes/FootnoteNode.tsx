import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import {
  $footnoteDefinitions,
  footnoteId,
  footnoteReferenceId,
  FootnoteReferenceNode as HeadlessFootnoteReferenceNode,
} from "@packages/lexical-nodes";
import {
  $getRoot,
  $isElementNode,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { useEffect, useState } from "react";

type Note = { number: number; text: string };

type Footnotes = {
  notes: Map<string, Note>;
  /** The first marker of each label, which the note's back-link returns to. */
  firstMarkers: Map<string, NodeKey>;
};

const cache = new WeakMap<EditorState, Footnotes>();

/** Every note's number and text, worked out once per editor state. */
function footnotesOf(editorState: EditorState): Footnotes {
  const cached = cache.get(editorState);
  if (cached) return cached;
  const footnotes = editorState.read((): Footnotes => {
    const notes = new Map<string, Note>();
    for (const definition of $footnoteDefinitions()) {
      const label = definition.getLabel();
      if (!notes.has(label))
        notes.set(label, {
          number: notes.size + 1,
          text: definition.getTextContent().trim(),
        });
    }
    const firstMarkers = new Map<string, NodeKey>();
    const visit = (node: LexicalNode) => {
      if (node instanceof HeadlessFootnoteReferenceNode) {
        if (!firstMarkers.has(node.getLabel()))
          firstMarkers.set(node.getLabel(), node.getKey());
      } else if ($isElementNode(node)) {
        for (const child of node.getChildren()) visit(child);
      }
    };
    visit($getRoot());
    return { notes, firstMarkers };
  });
  cache.set(editorState, footnotes);
  return footnotes;
}

function useFootnotes(editor: LexicalEditor): Footnotes {
  const [footnotes, setFootnotes] = useState(() =>
    footnotesOf(editor.getEditorState()),
  );
  useEffect(() => {
    setFootnotes(footnotesOf(editor.getEditorState()));
    return editor.registerUpdateListener(({ editorState }) =>
      setFootnotes(footnotesOf(editorState)),
    );
  }, [editor]);
  return footnotes;
}

function FootnoteMarker({
  label,
  nodeKey,
}: {
  label: string;
  nodeKey: NodeKey;
}) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const { notes, firstMarkers } = useFootnotes(editor);
  const [open, setOpen] = useState(false);
  const note = notes.get(label);
  const previewId = `${footnoteReferenceId(label)}-${nodeKey}-preview`;
  return (
    <>
      <a
        className="footnote-ref-link"
        href={`#${footnoteId(label)}`}
        id={
          firstMarkers.get(label) === nodeKey
            ? footnoteReferenceId(label)
            : undefined
        }
        aria-describedby={note ? previewId : undefined}
        data-open={open || undefined}
        onClick={(event) => {
          // A tap shows the note; a second one, or a reader's click, goes to it.
          if (editable || (!open && matchMedia("(hover: none)").matches)) {
            event.preventDefault();
            setOpen((shown) => !shown);
          }
        }}
        onBlur={() => setOpen(false)}
      >
        {note ? note.number : `${label}?`}
      </a>
      {note && (
        <span id={previewId} role="tooltip" className="footnote-preview">
          <span className="footnote-preview-number">{note.number}.</span>{" "}
          {note.text}
        </span>
      )}
    </>
  );
}

/** React half of the package's FootnoteReferenceNode; see ImageNode. */
export class FootnoteReferenceNode extends HeadlessFootnoteReferenceNode {
  $config() {
    return this.config("footnote-reference", {
      extends: HeadlessFootnoteReferenceNode,
    });
  }

  decorate(): React.JSX.Element {
    return <FootnoteMarker label={this.__label} nodeKey={this.__key} />;
  }
}
