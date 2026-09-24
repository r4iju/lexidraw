import type { ComponentProps } from "react";
import Editor from "./lazy-document-editor";
import { DocumentTypography } from "./document-typography";

export default function DocumentEditor(props: ComponentProps<typeof Editor>) {
  return (
    <DocumentTypography entity={props.entity}>
      <Editor {...props} />
    </DocumentTypography>
  );
}
