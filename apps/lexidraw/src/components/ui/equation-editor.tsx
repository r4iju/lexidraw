import type React from "react";
import type { ChangeEvent, Ref } from "react";
import "./equation-editor.css";

type BaseEquationEditorProps = {
  equation: string;
  inline: boolean;
  setEquation: (equation: string) => void;
  ref?: Ref<HTMLInputElement | HTMLTextAreaElement>;
};

const EquationEditor = ({
  equation,
  setEquation,
  inline,
  ref,
}: BaseEquationEditorProps): React.JSX.Element => {
  const onChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setEquation(event.target.value);
  };

  return inline ? (
    <span className="EquationEditor_inputBackground">
      <span className="EquationEditor_dollarSign">$</span>
      <input
        className="EquationEditor_inlineEditor"
        value={equation}
        onChange={onChange}
        ref={ref as React.Ref<HTMLInputElement>}
      />
      <span className="EquationEditor_dollarSign">$</span>
    </span>
  ) : (
    <div className="EquationEditor_inputBackground">
      <span className="EquationEditor_dollarSign">{"$$\n"}</span>
      <textarea
        className="EquationEditor_blockEditor"
        value={equation}
        onChange={onChange}
        ref={ref as React.Ref<HTMLTextAreaElement>}
      />
      <span className="EquationEditor_dollarSign">{"\n$$"}</span>
    </div>
  );
};

export default EquationEditor;
