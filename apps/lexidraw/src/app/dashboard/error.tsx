"use client";

import { AppError } from "~/components/error-screen";

export default function HomeError({ reset }: { reset: () => void }) {
  return (
    <AppError
      title="Your files couldn’t be loaded"
      description="Lexidraw didn’t answer in time or hit a problem. Try again in a moment."
      reset={reset}
    />
  );
}
