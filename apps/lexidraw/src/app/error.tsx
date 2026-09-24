"use client";

import { AppError } from "~/components/error-screen";

export default function RootError({ reset }: { reset: () => void }) {
  return <AppError reset={reset} />;
}
