"use client";

import type { ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";

type Props = {
  children: ReactNode;
};

export default function Contexts({ children }: Props) {
  return (
    <>
      <DndContext>{children}</DndContext>
    </>
  );
}
