"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

/**
 * Home's title and toolbar, held at the top while the files scroll under
 * them. Once scrolled, the bar tightens so the list keeps the room.
 */
export function StickyBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry?.isIntersecting),
      { root: el.closest("main") },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px shrink-0" />
      <div
        data-scrolled={scrolled || undefined}
        className={cn(
          "group/bar sticky top-0 z-20 shrink-0 border-b border-transparent bg-background transition-[border-color] data-scrolled:border-border",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

/** On phones: the view, tag, layout and sort controls, behind one button. */
export function FilterSortSheet({
  active,
  children,
}: {
  /** How many filters narrow the list now. */
  active: number;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="relative">
          <SlidersHorizontalIcon className="size-5" />
          <span className="sr-only">
            Filter & sort{active > 0 ? `, ${active} active` : ""}
          </span>
          {active > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary"
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Filter & sort</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">{children}</div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled group of controls in the filter sheet. */
export function SheetField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
