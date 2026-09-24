"use client";

import { FileQuestionIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";

/** One calm page for everything that went wrong: what happened, then a way on. */
function ErrorScreen({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 py-16 sm:px-6 lg:px-8 text-center"
    >
      <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">
        {icon}
      </div>
      <h1 className="text-title font-semibold">{title}</h1>
      <p className="max-w-sm text-muted-foreground">{description}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {children}
      </div>
    </main>
  );
}

/**
 * What a route shows when rendering it throws. Trying again re-renders the
 * route; Home is the way out when it keeps failing.
 */
export function AppError({
  title = "Something went wrong",
  description = "This page couldn’t be shown. Try again, or go back to Home.",
  reset,
}: {
  title?: string;
  description?: string;
  reset: () => void;
}) {
  return (
    <ErrorScreen
      icon={<TriangleAlertIcon aria-hidden="true" />}
      title={title}
      description={description}
    >
      <Button type="button" onClick={reset}>
        Try again
      </Button>
      <Button asChild variant="ghost">
        <Link href="/dashboard">Back to Home</Link>
      </Button>
    </ErrorScreen>
  );
}

export function NotFoundScreen({ signedIn }: { signedIn: boolean }) {
  return (
    <ErrorScreen
      icon={<FileQuestionIcon aria-hidden="true" />}
      title="Page not found"
      description="The link may be broken, or the file was moved or deleted."
    >
      <Button asChild>
        {signedIn ? (
          <Link href="/dashboard">Back to Home</Link>
        ) : (
          <Link href="/">Go to Lexidraw</Link>
        )}
      </Button>
    </ErrorScreen>
  );
}
