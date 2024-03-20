"use client";

import type { THEME } from "@excalidraw/excalidraw";
import Image from "next/image";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { api } from "~/trpc/react";

type Props = {
  drawingId: string;
};

export function Thumbnail({ drawingId }: Props) {
  // return
  const isDarkTheme = useIsDarkTheme();
  const { data: svg } = api.snapshot.get.useQuery({
    drawingId,
    theme: isDarkTheme
      ? ("dark" satisfies typeof THEME.DARK)
      : ("light" satisfies typeof THEME.LIGHT),
  });
  if (!svg) return;
  const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return (
    <>
      <Image
        src={svgDataUrl}
        alt={`Thumbnail for ${drawingId}`}
        className="aspect-[4/3] h-auto w-full"
        width={500}
        height={400}
      />
    </>
  );
}
