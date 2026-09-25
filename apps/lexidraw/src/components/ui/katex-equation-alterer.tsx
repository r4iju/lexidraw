import "./katex-equation-alterer.css";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type * as React from "react";
import { useCallback, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Button } from "./button";
import { DialogFooter } from "./dialog";
import KatexRenderer from "./katex-renderer";

type Props = {
  initialEquation?: string;
  onConfirm: (equation: string, inline: boolean) => void;
  onCancel: () => void;
};

export default function KatexEquationAlterer({
  onConfirm,
  onCancel,
  initialEquation = "",
}: Props): React.JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [equation, setEquation] = useState<string>(initialEquation);
  const [inline, setInline] = useState<boolean>(true);

  const onCheckboxChange = useCallback(() => {
    setInline(!inline);
  }, [inline]);

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(equation, inline);
      }}
    >
      <label className="KatexEquationAlterer_defaultRow">
        Inline
        <input type="checkbox" checked={inline} onChange={onCheckboxChange} />
      </label>
      <label
        htmlFor="katex-equation"
        className="KatexEquationAlterer_defaultRow"
      >
        Equation
      </label>
      <div className="KatexEquationAlterer_centerRow">
        {inline ? (
          <input
            id="katex-equation"
            onChange={(event) => {
              setEquation(event.target.value);
            }}
            value={equation}
            className="KatexEquationAlterer_textArea"
          />
        ) : (
          <textarea
            id="katex-equation"
            onChange={(event) => {
              setEquation(event.target.value);
            }}
            value={equation}
            className="KatexEquationAlterer_textArea"
          />
        )}
      </div>
      <div className="KatexEquationAlterer_defaultRow">Visualization </div>
      <div className="KatexEquationAlterer_centerRow">
        <ErrorBoundary
          onError={(e) =>
            editor._onError(e instanceof Error ? e : new Error(String(e)))
          }
          fallback={null}
        >
          <KatexRenderer
            equation={equation}
            inline={false}
            onDoubleClick={() => null}
          />
        </ErrorBoundary>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {initialEquation ? "Save equation" : "Insert equation"}
        </Button>
      </DialogFooter>
    </form>
  );
}
