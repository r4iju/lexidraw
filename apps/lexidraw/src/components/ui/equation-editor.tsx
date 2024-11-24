/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import React, { ChangeEvent, Ref } from "react";
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
}: BaseEquationEditorProps): JSX.Element => {
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
        autoFocus
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
