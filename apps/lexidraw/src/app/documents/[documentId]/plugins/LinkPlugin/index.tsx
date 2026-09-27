import { LinkPlugin as LexicalLinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { validateUrl } from "@packages/lexical-nodes/links";
import type * as React from "react";

export default function LinkPlugin(): React.JSX.Element {
  return <LexicalLinkPlugin validateUrl={validateUrl} />;
}
