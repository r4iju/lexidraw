"use client";
import { createContext, useContext } from "react";
export type BlockPreview =
  | {
      status: "ready";
      revision: string;
      data: string;
      width: number;
      height: number;
    }
  | {
      status: "failed";
      revision: string;
      message: string;
      width: number;
      height: number;
    };
export const HTMLBlockPreviews = createContext<Record<
  string,
  BlockPreview
> | null>(null);
export function useHTMLBlockPreviews() {
  return useContext(HTMLBlockPreviews);
}
