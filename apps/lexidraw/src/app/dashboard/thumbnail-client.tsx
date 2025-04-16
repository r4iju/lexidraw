"use client";

import { Folder } from "lucide-react";
import Image from "next/image";
import { useDeferredValue, useMemo } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
};

export function ThumbnailClient({ entity }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const deferredIsDarkTheme = useDeferredValue(isDarkTheme);
  const src = useMemo(
    () =>
      deferredIsDarkTheme ? entity.screenShotDark : entity.screenShotLight,
    [deferredIsDarkTheme, entity.screenShotDark, entity.screenShotLight],
  );
  const isDefaultDirectory = entity.entityType === "directory" && !src;

  return (
    <div className="relative size-full aspect-[4/3] border border-border rounded-sm overflow-hidden">
      <span className="sr-only">{`Thumbnail for ${entity.title}`}</span>
      {isDefaultDirectory && (
        <Folder className="size-full text-muted-foreground" />
      )}
      {src && (
        <Image
          src={src}
          alt={entity.title.substring(0, 14)}
          fill
          crossOrigin="anonymous"
          quality={75}
          loading="eager"
          className="object-cover"
        />
      )}
      {!src && !isDefaultDirectory && <ThumbnailFallback />}
    </div>
  );
}

export function ThumbnailFallback() {
  return (
    <div className="aspect-[4/3] size-full bg-muted-foreground animate-pulse rounded-sm" />
  );
}
