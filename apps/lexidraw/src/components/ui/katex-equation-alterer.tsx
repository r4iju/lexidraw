import "./katex-equation-alterer.css";

import type * as React from "react";
import { Suspense, useCallback, useState } from "react";

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
        <Suspense fallback={null}>
          <KatexRenderer
            equation={equation}
            inline={false}
            onDoubleClick={() => null}
          />
        </Suspense>
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
