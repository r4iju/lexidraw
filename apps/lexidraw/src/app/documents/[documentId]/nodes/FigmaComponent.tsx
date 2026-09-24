import { BlockWithAlignableContents } from "@lexical/react/LexicalBlockWithAlignableContents";
import type { ElementFormatType, NodeKey } from "lexical";
import { PrintedLink } from "./common/PrintedLink";

type FigmaComponentProps = Readonly<{
  className: Readonly<{
    base: string;
    focus: string;
  }>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  documentID: string;
}>;

export default function FigmaComponent({
  className,
  format,
  nodeKey,
  documentID,
}: FigmaComponentProps) {
  return (
    <BlockWithAlignableContents
      className={className}
      format={format}
      nodeKey={nodeKey}
    >
      <iframe
        className="document-embed print:hidden"
        style={{
          width: "100%",
          height: "auto",
          aspectRatio: "16 / 9",
          colorScheme: "normal",
        }}
        title="Figma Embed"
        width="560"
        height="315"
        src={`https://www.figma.com/embed?embed_host=lexical&url=\
        https://www.figma.com/file/${documentID}`}
        allowFullScreen={true}
      />
      <PrintedLink href={`https://www.figma.com/file/${documentID}`} />
    </BlockWithAlignableContents>
  );
}
