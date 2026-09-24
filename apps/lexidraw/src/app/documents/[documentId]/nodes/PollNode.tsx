import { PollNode as HeadlessPollNode } from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading } from "./common/BlockLoading";

export type {
  Option,
  Options,
  SerializedPollNode,
} from "@packages/lexical-nodes";

const PollComponent = React.lazy(() => import("./PollComponent"));

/** React half of the package's PollNode; see ImageNode. */
export class PollNode extends HeadlessPollNode {
  static getType = HeadlessPollNode.getType;
  static clone = HeadlessPollNode.clone;
  static importJSON = HeadlessPollNode.importJSON;

  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={<BlockLoading />}>
        <PollComponent
          question={this.__question}
          options={this.__options}
          nodeKey={this.__key}
        />
      </Suspense>
    );
  }
}
