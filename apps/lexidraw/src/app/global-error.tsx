"use client";

import "~/styles/globals.css";

import { AppError } from "~/components/error-screen";

/** Stands in for the root layout when the layout itself fails to render. */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-background font-sans text-foreground antialiased">
        <AppError reset={reset} />
      </body>
    </html>
  );
}
