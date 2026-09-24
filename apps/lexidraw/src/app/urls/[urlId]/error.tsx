"use client";

import { AppError } from "~/components/error-screen";

export default function LinkError({ reset }: { reset: () => void }) {
  return (
    <AppError
      title="This link couldn’t be opened"
      description="Something went wrong while showing the saved page. Try again, or go back to Home."
      reset={reset}
    />
  );
}
