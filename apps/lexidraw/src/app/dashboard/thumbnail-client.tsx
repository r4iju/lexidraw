"use client";

import { Folder, File, Brush, Newspaper } from "lucide-react";
import type { JSX } from "react";
import Image from "next/image";
import {
  useDeferredValue,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  size?: "small" | "large"; // list vs card
};

export function ThumbnailClient({ entity, size = "large" }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const deferredIsDarkTheme = useDeferredValue(isDarkTheme);
  const router = useRouter();
  type WithThumb = { thumbnailStatus?: "pending" | "ready" | "error" };
  const thumbnailStatus = (entity as unknown as WithThumb).thumbnailStatus;
  useEffect(() => {
    if (thumbnailStatus !== "pending") return;
    const id = setTimeout(() => {
      // Throttle with per-tab memory to avoid spamming RSC
      const now = Date.now();
      const MIN_GAP_MS = 8000;
      try {
        const last = Number(sessionStorage.getItem("ld_dash_refresh_at") || 0);
        if (now - last < MIN_GAP_MS) return;
        sessionStorage.setItem("ld_dash_refresh_at", String(now));
      } catch {
        // sessionStorage might be unavailable; proceed without throttle
      }
      router.refresh();
    }, 8000);
    return () => clearTimeout(id);
  }, [thumbnailStatus, router]);
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
      <UrlVisual
        title={entity.title}
        src={src}
        isPending={
          (entity as unknown as WithThumb).thumbnailStatus === "pending"
        }
        size={size}
      />
    );
  }

  // Differentiated visuals for documents and drawings
  if (entity.entityType === "document") {
    return (
      <DocumentVisual
        title={entity.title}
        src={src}
        isPending={
          (entity as unknown as WithThumb).thumbnailStatus === "pending"
        }
        size={size}
      />
    );
  }

  if (entity.entityType === "drawing") {
    return (
      <DrawingVisual
        title={entity.title}
        src={src}
        isPending={
          (entity as unknown as WithThumb).thumbnailStatus === "pending"
        }
        size={size}
      />
    );
  }

  return (
    <div className="relative w-full aspect-4/3 rounded-sm overflow-hidden">
      <span className="sr-only">{`Thumbnail for ${entity.title}`}</span>
      {src && (
        <Image
          src={src}
          data-original-url={src}
          alt={entity.title.substring(0, 14)}
          fill
          crossOrigin="anonymous"
          quality={75}
          loading="eager"
          draggable={false}
          className="object-cover object-left"
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
      )}
      {!src && <ThumbnailFallback />}
      {(entity as unknown as WithThumb).thumbnailStatus === "pending" && (
        <div className="absolute inset-0 bg-foreground/5 animate-pulse" />
      )}
      <div className="pointer-events-none absolute inset-0 rounded-sm border border-border" />
    </div>
  );
}

export function ThumbnailFallback() {
  return (
    <div className="w-full aspect-4/3 bg-muted-foreground animate-pulse rounded-sm" />
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
      className="relative w-full aspect-4/3 overflow-hidden"
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
                data-original-url={src}
                alt={title.substring(0, 14)}
                fill
                crossOrigin="anonymous"
                quality={75}
                loading="eager"
                draggable={false}
                className="object-cover object-left"
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

function TypeRibbon({
  variant,
  icon,
  size,
}: {
  variant: "document" | "drawing" | "url";
  icon: JSX.Element;
  size: "small" | "large";
}) {
  const label = useMemo(() => {
    switch (variant) {
      case "document":
        return "Doc";
      case "drawing":
        return "Drawing";
      case "url":
        return "Article";
      default:
        return "";
    }
  }, [variant]);

  if (size === "large") {
    // Corner tab that bleeds outside the right edge ~30%
    return (
      <div
        className={cn(
          "pointer-events-none absolute right-0 top-0 translate-x-1/8 -translate-y-1/3 z-10",
          "rounded-xs bg-background/90 backdrop-blur-xs shadow-sm",
          "text-muted-foreground",
          "h-7 px-2 flex items-center gap-1",
        )}
      >
        <span className="grid place-items-center p-[2px]" aria-hidden="true">
          {icon}
        </span>
        <span className="text-2xs font-medium select-none">{label}</span>
      </div>
    );
  }
  // Small circular chip for list view, stays inside bounds
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-[-4px] top-[-4px] size-5",
      )}
    >
      <div
        className={cn(
          "grid place-items-center bg-background/90 backdrop-blur-xs shadow-sm size-5",
          "text-muted-foreground rounded-[6px]",
        )}
      >
        <span className="grid place-items-center size-5" aria-hidden="true">
          {icon}
        </span>
      </div>
    </div>
  );
}

function DocumentVisual({
  title,
  src,
  size,
}: {
  title: string;
  src?: string | null;
  isPending?: boolean;
  size: "small" | "large";
}) {
  return (
    <div className="relative w-full aspect-4/3">
      <span className="sr-only">{`Document: ${title}`}</span>
      <div className="absolute inset-0 rounded-sm overflow-hidden">
        {src ? (
          <Image
            src={src}
            data-original-url={src}
            alt={title.substring(0, 14)}
            fill
            crossOrigin="anonymous"
            quality={75}
            loading="eager"
            draggable={false}
            className="object-cover object-left"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 bg-card" />
        )}

        {!src && (
          <div className="absolute inset-0 opacity-70 bg-[repeating-linear-gradient(transparent,transparent_12px,theme(colors.border)_12px,theme(colors.border)_13px)]" />
        )}

        <div className="pointer-events-none absolute inset-0 rounded-sm border border-border" />
      </div>

      <TypeRibbon
        variant="document"
        icon={
          <File
            className={cn(size === "large" ? "size-4" : "size-4")}
            aria-hidden="true"
          />
        }
        size={size}
      />
    </div>
  );
}

function DrawingVisual({
  title,
  src,
  isPending,
  size,
}: {
  title: string;
  src?: string | null;
  isPending?: boolean;
  size: "small" | "large";
}) {
  return (
    <div className="relative w-full aspect-4/3">
      <span className="sr-only">{`Drawing: ${title}`}</span>
      <div className="absolute inset-0 rounded-sm overflow-hidden bg-card">
        {src ? (
          <Image
            src={src}
            data-original-url={src}
            alt={title.substring(0, 14)}
            fill
            crossOrigin="anonymous"
            quality={75}
            loading="eager"
            draggable={false}
            className="object-cover object-left"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 bg-muted/30" />
        )}

        {/* subtle dot grid overlay when missing screenshot; very faint when has screenshot */}
        <div
          className={cn(
            "absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,theme(colors.border)_1px,transparent_1px)] bg-[length:12px_12px]",
            src ? "opacity-20" : "opacity-60",
          )}
        />

        {isPending && (
          <div className="absolute inset-0 bg-foreground/5 animate-pulse" />
        )}

        <div className="pointer-events-none absolute inset-0 rounded-sm border border-border" />
      </div>

      <TypeRibbon
        variant="drawing"
        icon={
          <Brush
            className={cn(size === "large" ? "size-4" : "size-4")}
            aria-hidden="true"
          />
        }
        size={size}
      />
    </div>
  );
}

function UrlVisual({
  title,
  src,
  isPending,
  size,
}: {
  title: string;
  src?: string | null;
  isPending?: boolean;
  size: "small" | "large";
}) {
  return (
    <div className="relative w-full aspect-4/3">
      <span className="sr-only">{`Drawing: ${title}`}</span>
      <div className="absolute inset-0 rounded-sm overflow-hidden">
        {src ? (
          <Image
            src={src}
            data-original-url={src}
            alt={title.substring(0, 14)}
            fill
            crossOrigin="anonymous"
            quality={75}
            loading="eager"
            draggable={false}
            className="object-contain bg-background"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 bg-muted/30" />
        )}
        {/* subtle dot grid overlay only when missing screenshot */}
        {!src && (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,theme(colors.border)_1px,transparent_1px)] bg-[length:12px_12px] opacity-60" />
        )}

        {isPending && (
          <div className="absolute inset-0 bg-foreground/5 animate-pulse" />
        )}

        <div className="pointer-events-none absolute inset-0 rounded-sm border border-border" />
      </div>

      <TypeRibbon
        variant="url"
        icon={
          <Newspaper
            className={cn(size === "large" ? "size-4" : "size-4")}
            aria-hidden="true"
          />
        }
        size={size}
      />
    </div>
  );
}
