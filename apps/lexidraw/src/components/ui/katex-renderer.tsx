import type * as React from "react";
import { use } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { katexOptions, loadKatex, loadedKatex } from "~/lib/katex";

/**
 * An empty image either side keeps Android from composing the equation's text
 * into what is typed next; a data address, so it asks the server for nothing.
 */
const SPACER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type Props = Readonly<{
  equation: string;
  inline: boolean;
  onDoubleClick: () => void;
  onClick?: () => void;
}>;

/**
 * An equation, drawn as it first renders so its size is right from the
 * start; its TeX, still editable, when KaTeX cannot load.
 */
export default function KatexRenderer(props: Props): React.JSX.Element {
  return (
    <ErrorBoundary
      fallback={
        <Equation {...props}>
          <code>{props.equation}</code>
        </Equation>
      }
    >
      <Drawn {...props} />
    </ErrorBoundary>
  );
}

function Drawn(props: Props) {
  const katex = loadedKatex() ?? use(loadKatex());
  return (
    <Equation
      {...props}
      html={katex.renderToString(props.equation, katexOptions(props.inline))}
    />
  );
}

function Equation({
  onDoubleClick,
  onClick,
  html,
  children,
}: Props & { html?: string; children?: React.ReactNode }) {
  const shared = {
    type: "button",
    tabIndex: -1,
    onDoubleClick,
    onClick,
    "aria-label": "Rendered equation",
  } as const;
  return (
    <>
      <img src={SPACER} alt="" width={0} height={0} />
      {html === undefined ? (
        <button {...shared}>{children}</button>
      ) : (
        <button
          {...shared}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX's own markup, with `trust` off
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      <img src={SPACER} alt="" width={0} height={0} />
    </>
  );
}
