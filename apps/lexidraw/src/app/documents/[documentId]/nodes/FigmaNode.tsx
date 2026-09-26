import {
  $getFigure,
  FigmaNode as HeadlessFigmaNode,
} from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading } from "./common/BlockLoading";
import { FigureFrame } from "./common/Figure";

export type { SerializedFigmaNode } from "@packages/lexical-nodes";

const FigmaComponent = React.lazy(() => import("./FigmaComponent"));

/** React half of the package's FigmaNode; see ImageNode. */
export class FigmaNode extends HeadlessFigmaNode {
  $config() {
    return this.config("figma", { extends: HeadlessFigmaNode });
  }

  decorate(_editor: LexicalEditor, config: EditorConfig): React.JSX.Element {
    const embedBlockTheme = config.theme.embedBlock || {};
    const className = {
      base: embedBlockTheme.base || "",
      focus: embedBlockTheme.focus || "",
    };
    return (
      <FigureFrame nodeKey={this.getKey()} figure={$getFigure(this)}>
        <Suspense fallback={<BlockLoading />}>
          <FigmaComponent
            className={className}
            format={this.__format}
            nodeKey={this.getKey()}
            documentID={this.__id}
          />
        </Suspense>
      </FigureFrame>
    );
  }
}
