"use client";

import { Folder } from "lucide-react";
import Image from "next/image";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
};

export function ThumbnailClient({ entity }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const src = isDarkTheme ? entity.screenShotDark : entity.screenShotLight;

  if (
    entity.entityType === "directory" &&
    !entity.screenShotDark &&
    !entity.screenShotLight
  ) {
    return <Folder className="size-full aspect-[4/3] text-muted-foreground" />;
  }

  if (src === "") {
    return <ThumbnailFallback />;
  }

  return (
    <>
      <span className="sr-only">{`Thumbnail for ${entity.title}`}</span>
      <Image
        src={src}
        alt={entity.title.substring(0, 14)}
        width={400}
        height={300}
        crossOrigin="anonymous"
        className="aspect-[4/3]"
        style={{ width: "auto", height: "auto" }}
      />
    </>
  );
}

export function ThumbnailFallback() {
  return (
    <div className="aspect-[4/3] min-h-[300px] bg-muted-foreground animate-pulse rounded-sm" />
  );
}
