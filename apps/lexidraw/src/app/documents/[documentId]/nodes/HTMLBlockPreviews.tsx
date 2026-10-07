"use client";
import { createContext, useContext } from "react";
import type { RouterOutputs } from "~/trpc/shared";
export type BlockPreview = RouterOutputs["htmlBlocks"]["preview"];
export const HTMLBlockPreviews = createContext<Record<
  string,
  BlockPreview
> | null>(null);
export function useHTMLBlockPreviews() {
  return useContext(HTMLBlockPreviews);
}
