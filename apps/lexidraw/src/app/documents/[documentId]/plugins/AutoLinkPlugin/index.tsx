import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { AUTOLINK_MATCHERS } from "@packages/lexical-nodes/links";
import type * as React from "react";

export default function LexicalAutoLinkPlugin(): React.JSX.Element {
  return <AutoLinkPlugin matchers={AUTOLINK_MATCHERS} />;
}
