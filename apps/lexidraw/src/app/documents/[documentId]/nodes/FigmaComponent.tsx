import { BlockWithAlignableContents } from "@lexical/react/LexicalBlockWithAlignableContents";
import { figmaEmbedUrl, mediaLink } from "@packages/lexical-nodes/media-links";
import type { ElementFormatType, NodeKey } from "lexical";
import { useState } from "react";
import { FigmaIcon } from "~/components/icons/figma";
import {
  EmbedFallback,
  EmbedLoading,
  SourceLink,
  embedAlign,
} from "./common/embed";
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
  const [loaded, setLoaded] = useState(false);
  const href = mediaLink("figma", documentID);
  if (!href)
    return (
      <BlockWithAlignableContents
        className={className}
        format={format}
        nodeKey={nodeKey}
      >
        <EmbedFallback icon={<FigmaIcon />} message="No Figma file linked" />
      </BlockWithAlignableContents>
    );
  return (
    <BlockWithAlignableContents
      className={className}
      format={format}
      nodeKey={nodeKey}
    >
      <div className="print:hidden" data-embed-align={embedAlign(format)}>
        <div
          aria-busy={!loaded || undefined}
          className="document-embed relative aspect-video w-full"
        >
          <iframe
            className="absolute inset-0 size-full"
            style={{ colorScheme: "normal" }}
            title="Figma Embed"
            src={figmaEmbedUrl(href)}
            allowFullScreen={true}
            onLoad={() => setLoaded(true)}
          />
          {!loaded && <EmbedLoading />}
        </div>
        {/* Figma's page for a file that is not shared cannot be told apart from outside. */}
        <div className="mt-1.5 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <FigmaIcon className="size-3.5" />
          <SourceLink source={{ href, label: "Open in Figma" }} />
        </div>
      </div>
      <PrintedLink href={href} />
    </BlockWithAlignableContents>
  );
}
