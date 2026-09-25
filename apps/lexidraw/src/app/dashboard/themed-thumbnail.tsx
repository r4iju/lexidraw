"use client";

import Image from "next/image";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

type Props = {
  light?: string | null;
  dark?: string | null;
  alt: string;
  sizes: string;
  className?: string;
  /** Shown in a theme that has no picture. */
  fallback: ReactNode;
  /** Off the first screen: fetched only once it comes near the screen. */
  deferred?: boolean;
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
  deferred = false,
}: Props) {
  const [near, sentinel] = useNear(!deferred);
  if (!near)
    return (
      <span ref={sentinel} aria-hidden="true" className="absolute inset-0" />
    );
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

/** The nearest ancestor that scrolls, whose edge is where "near" is measured from. */
function scroller(element: Element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/**
 * Whether an element is within a row or two of the screen, and has been since it
 * first was. A browser's own lazy loading starts screens ahead, which in a
 * long list is most of it.
 */
function useNear(initially: boolean) {
  const [near, setNear] = useState(initially);
  const sentinel = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = sentinel.current;
    if (near || !target) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { root: scroller(target), rootMargin: "0px 0px 100px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [near]);
  return [near, sentinel] as const;
}
