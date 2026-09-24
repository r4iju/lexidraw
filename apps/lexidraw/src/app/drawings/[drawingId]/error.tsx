"use client";

import { AppError } from "~/components/error-screen";

export default function DrawingError({ reset }: { reset: () => void }) {
  return (
    <AppError
      title="This drawing couldn’t be opened"
      description="Something went wrong while showing it. Your saved work is safe; try again, or go back to Home."
      reset={reset}
    />
  );
}
