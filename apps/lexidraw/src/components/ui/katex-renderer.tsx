import type * as React from "react";
import { use } from "react";
import { katexOptions, loadKatex, loadedKatex } from "~/lib/katex";

/**
 * An empty image either side keeps Android from composing the equation's text
 * into what is typed next; a data address, so it asks the server for nothing.
 */
const SPACER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** An equation, drawn as it first renders so its size is right from the start. */
export default function KatexRenderer({
  equation,
  inline,
  onDoubleClick,
  onClick,
}: Readonly<{
  equation: string;
  inline: boolean;
  onDoubleClick: () => void;
  onClick?: () => void;
}>): React.JSX.Element {
  const katex = loadedKatex() ?? use(loadKatex());
  return (
    <>
      <img src={SPACER} alt="" width={0} height={0} />
      <button
        type="button"
        tabIndex={-1}
        onDoubleClick={onDoubleClick}
        onClick={onClick}
        aria-label="Rendered equation"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX's own markup, with `trust` off
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(equation, katexOptions(inline)),
        }}
      />
      <img src={SPACER} alt="" width={0} height={0} />
    </>
  );
}
