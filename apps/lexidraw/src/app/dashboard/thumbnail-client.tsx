"use client";

import { Folder, Link2 } from "lucide-react";
import Image from "next/image";
import {
  useDeferredValue,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
};

export function ThumbnailClient({ entity }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const deferredIsDarkTheme = useDeferredValue(isDarkTheme);
  const src = useMemo(() => {
    const base = deferredIsDarkTheme
      ? entity.screenShotDark
      : entity.screenShotLight;
    if (!base) return base;
    const ver = String(
      (entity as unknown as { updatedAt?: number | string }).updatedAt ?? "",
    );
    if (!ver) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}v=${ver}`;
  }, [
    deferredIsDarkTheme,
    entity.screenShotDark,
    entity.screenShotLight,
    entity,
  ]);

  // Folder visual using design-system colors; keeps screenshot visible under outline
  if (entity.entityType === "directory") {
    const childCount = (entity as unknown as { childCount?: number })
      .childCount;
    return (
      <FolderVisual
        id={entity.id}
        title={entity.title}
        childCount={childCount}
        src={src}
      />
    );
  }

  if (entity.entityType === "url") {
    return (
      <div className="relative size-full aspect-4/3 rounded-sm border border-border overflow-hidden grid place-items-center">
        <span className="sr-only">{`Link: ${entity.title}`}</span>
        {src ? (
          <Image
            src={src}
            alt={entity.title.substring(0, 14)}
            fill
            crossOrigin="anonymous"
            quality={75}
            loading="eager"
            draggable={false}
            className="object-contain bg-background"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <Link2 className="size-10 text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <div className="relative size-full aspect-4/3 rounded-sm overflow-hidden">
      <span className="sr-only">{`Thumbnail for ${entity.title}`}</span>
      {src && (
        <Image
          src={src}
          alt={entity.title.substring(0, 14)}
          fill
          crossOrigin="anonymous"
          quality={75}
          loading="eager"
          draggable={false}
          className="object-cover"
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
      )}
      {!src && <ThumbnailFallback />}
      <div className="pointer-events-none absolute inset-0 rounded-sm border border-border" />
    </div>
  );
}

export function ThumbnailFallback() {
  return (
    <div className="aspect-4/3 size-full bg-muted-foreground animate-pulse rounded-sm" />
  );
}

function FolderVisual({
  id: _id,
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
  const [_strokeWidth, setStrokeWidth] = useState(1.6);
  const [isBig, setIsBig] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth || 96;
      const base = Math.max(1.2, Math.min(2.1, (w / 96) * 1.5));
      setStrokeWidth(parseFloat(base.toFixed(2)));
      setIsBig(w >= 160);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative size-full aspect-4/3 overflow-hidden"
    >
      <span className="sr-only">{`Folder: ${title}`}</span>
      {(() => {
        // Use the Lucide Folder path as the mask base (24x24 viewBox)
        const lucidePath =
          "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z";
        const maskSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' preserveAspectRatio='none'><path d='${lucidePath}' fill='white'/></svg>`;
        const maskUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(maskSvg)}")`;
        const maskStyle: React.CSSProperties = {
          WebkitMaskImage: maskUrl,
          maskImage: maskUrl,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        };
        return (
          <div className="absolute inset-0" style={maskStyle}>
            {src ? (
              <Image
                src={src}
                alt={title.substring(0, 14)}
                fill
                crossOrigin="anonymous"
                quality={75}
                loading="eager"
                draggable={false}
                className="object-cover"
                sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            ) : (
              <ThumbnailFallback />
            )}
          </div>
        );
      })()}

      <Folder
        className="pointer-events-none absolute inset-0 size-full text-accent"
        preserveAspectRatio="none"
        vectorEffect="non-scaling-stroke"
        strokeWidth={isBig ? 0.5 : 2}
        aria-hidden="true"
      />

      {typeof childCount === "number" && (
        <div
          className={cn(
            "absolute z-10 grid place-items-center rounded-full border border-border bg-background text-foreground leading-none bottom-1 right-0 h-4 min-w-4 text-xs px-1 shadow-sm",
            {
              "top-10 right-5 h-10 min-w-10 text-xl shadow-md border-2": isBig,
            },
          )}
        >
          {childCount}
        </div>
      )}
    </div>
  );
}
