import type { ReactNode } from "react";
import { Card } from "~/components/ui/card";

/**
 * The page and card every sign-in, sign-up and sign-out step sits in: one
 * surface, the phone gutter, and a heading that shares the fields' left edge.
 */
export function AuthCard({
  title,
  description,
  children,
  after,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** A line under the card, such as the link to the other auth page. */
  after?: ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-[calc(100dvh-var(--header-height)-var(--footer-height))] flex-col items-center justify-center gap-4 px-4 py-8"
    >
      <Card className="flex w-full max-w-md flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-semibold text-foreground">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </Card>
      {after && <p className="text-sm text-muted-foreground">{after}</p>}
    </main>
  );
}

/** The "or" rule between the GitHub button and the email form. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
