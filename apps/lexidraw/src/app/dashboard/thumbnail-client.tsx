"use client";

import { Folder } from "lucide-react";
import Image from "next/image";
import { useDeferredValue, useMemo, useLayoutEffect, useRef, useState } from "react";
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

  // Folder visual using design-system colors; keeps screenshot visible under outline
  if (entity.entityType === "directory") {
    const childCount = (entity as any).childCount as number | undefined;
    return (
      <FolderVisual id={entity.id} title={entity.title} childCount={childCount} src={src} />
    );
  }

  return (
    <div className="relative size-full aspect-4/3 rounded-sm border border-border overflow-hidden">
      <span className="sr-only">{`Thumbnail for ${entity.title}`}</span>
      {src && (
        <Image
          src={src}
          alt={entity.title.substring(0, 14)}
          fill
          crossOrigin="anonymous"
          quality={75}
          loading="eager"
          className="object-cover"
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
      )}
      {!src && <ThumbnailFallback />}
    </div>
  );
}

export function ThumbnailFallback() {
  return (
    <div className="aspect-4/3 size-full bg-muted-foreground animate-pulse rounded-sm" />
  );
}

function FolderVisual({
  id,
  title,
  childCount,
  src,
}: {
  id: string;
  title: string;
  childCount?: number;
  src?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [strokeWidth, setStrokeWidth] = useState(1.5);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth || 96;
      const computed = Math.max(1, Math.min(2, (w / 96) * 1.4));
      setStrokeWidth(parseFloat(computed.toFixed(2)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative size-full aspect-4/3 overflow-hidden">
      <span className="sr-only">{`Folder: ${title}`}</span>
      <svg className="absolute inset-0" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <clipPath id={`clip-${id}`} clipPathUnits="userSpaceOnUse">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z" />
          </clipPath>
        </defs>
        {src ? (
          <image href={src} width="24" height="24" preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${id})`} />
        ) : (
          <rect width="24" height="24" className="fill-muted" clipPath={`url(#clip-${id})`} />
        )}
        <path
          d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"
          fill="none"
          className="text-accent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {typeof childCount === "number" && (
        <div className="absolute bottom-1 right-1 z-10 grid h-5 min-w-5 place-items-center rounded-full border border-border bg-background/90 text-foreground text-[10px] leading-none px-1 shadow-sm">
          {childCount}
        </div>
      )}
    </div>
  );
}
