"use client";

import type { THEME } from "@excalidraw/excalidraw";
import Image from "next/image";
import { useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { api } from "~/trpc/react";

type Props = {
  entityId: string;
};

export function Thumbnail({ entityId: entityId }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const [svgDataUrl, setSvgDataUrl] = useState<string | null>(null);
  const { isLoading } = api.snapshot.get.useQuery(
    {
      entityId: entityId,
      theme: isDarkTheme
        ? ("dark" satisfies typeof THEME.DARK)
        : ("light" satisfies typeof THEME.LIGHT),
    },
    {
      refetchOnWindowFocus: false,
      onSuccess: (svg) => {
        setSvgDataUrl(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
      },
    },
  );

  return (
    <>
      {isLoading && (
        <div className="aspect-[4/3] h-auto w-full animate-pulse">
          <div className="min-h-[300px] w-full dark:bg-zinc-950 bg-zinc-100 rounded-3xl border-2 border-zinc-900 dark:border-zinc-100  " />
        </div>
      )}
      {!isLoading && (
        <Image
          src={svgDataUrl as string}
          className="aspect-[4/3] h-auto w-full min-h-[300px]"
          alt={`Thumbnail for ${entityId}`}
          width={400}
          height={300}
        />
      )}
    </>
  );
}
