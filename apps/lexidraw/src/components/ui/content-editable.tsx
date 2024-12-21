/**
.ContentEditable__root {
  border: 0;
  font-size: 15px;
  display: block;
  position: relative;
  outline: 0;
  padding: 8px 28px 40px;
  min-height: 150px;
}
@media (max-width: 1025px) {
  .ContentEditable__root {
    padding-left: 8px;
    padding-right: 8px;
  }
}
 */

import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import * as React from "react";
import { cn } from "~/lib/utils";

export default function LexicalContentEditable({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <ContentEditable
      className={cn(
        "border-none font-medium block relative outline-none p-2",
        className,
      )}
    />
  );
}
