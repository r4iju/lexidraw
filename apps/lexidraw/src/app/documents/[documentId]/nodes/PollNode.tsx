import { PollNode as HeadlessPollNode } from "@packages/lexical-nodes";
import type * as React from "react";
import PollComponent from "./PollComponent";

export type {
  Option,
  Options,
  SerializedPollNode,
} from "@packages/lexical-nodes";

/** React half of the package's PollNode; see ImageNode. */
export class PollNode extends HeadlessPollNode {
  $config() {
    return this.config("poll", { extends: HeadlessPollNode });
  }

  decorate(): React.JSX.Element {
    return (
      <PollComponent
        question={this.__question}
        options={this.__options}
        nodeKey={this.__key}
      />
    );
  }
}
