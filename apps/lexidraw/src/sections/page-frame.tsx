import type { ReactNode } from "react";
import Header from "./header";

/**
 * A page that scrolls as a whole under the app bar, for pages that are read
 * top to bottom rather than worked in. `bar` replaces the default header, for
 * a page that has an app bar of its own.
 */
export function PageFrame({
  children,
  bar = <Header />,
}: {
  children: ReactNode;
  bar?: ReactNode;
}) {
  return (
    <div
      data-scroll-root="page"
      className="flex min-h-[var(--dynamic-viewport-height)] flex-col"
    >
      {bar}
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
