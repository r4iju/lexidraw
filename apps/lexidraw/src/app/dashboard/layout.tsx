import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function Layout({ children }: Props) {
  return (
    <div className="flex h-full min-h-0 max-w-[100dvw] flex-col overflow-hidden">
      {/* Each page brings its app bar, which knows where the page sits. */}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
