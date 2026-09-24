"use client";

import { AppError } from "~/components/error-screen";

export default function SettingsError({ reset }: { reset: () => void }) {
  return (
    <AppError
      title="Settings couldn’t be loaded"
      description="Nothing was changed. Try again, or go back to Home."
      reset={reset}
    />
  );
}
