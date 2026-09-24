import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type Props = {
  light?: string | null;
  dark?: string | null;
  alt: string;
  sizes: string;
  className?: string;
  /** Shown in a theme that has no picture. */
  fallback: ReactNode;
};

/**
 * A thumbnail in the theme the page is painted in. Both pictures are in the
 * markup and CSS shows one, so the first paint is already right; the hidden
 * one is lazy, and a browser doesn't fetch a lazy image it doesn't display.
 */
export function ThemedThumbnail({
  light,
  dark,
  alt,
  sizes,
  className,
  fallback,
}: Props) {
  const image = (src: string, theme: string) => (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      loading="lazy"
      draggable={false}
      crossOrigin="anonymous"
      className={cn("object-cover object-top-left", theme, className)}
    />
  );
  return (
    <>
      {light ? (
        image(light, "dark:hidden")
      ) : (
        <Only theme="light">{fallback}</Only>
      )}
      {dark ? (
        image(dark, "hidden dark:block")
      ) : (
        <Only theme="dark">{fallback}</Only>
      )}
    </>
  );
}

function Only({
  theme,
  children,
}: {
  theme: "light" | "dark";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0",
        theme === "light" ? "dark:hidden" : "hidden dark:block",
      )}
    >
      {children}
    </div>
  );
}
