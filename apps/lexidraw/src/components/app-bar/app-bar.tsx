"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppIcon } from "~/components/icons/app";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import { cn } from "~/lib/utils";
import { AccountMenu, type AppBarAccount } from "./account-menu";

/** One crumb; the ones before the last are left out on phones. */
export function Crumb({
  children,
  current = false,
  className,
}: {
  children: ReactNode;
  current?: boolean;
  className?: string;
}) {
  return (
    <li
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-w-0 items-center",
        "before:px-1.5 before:text-muted-foreground before:content-['/'] first:before:hidden",
        current ? "max-sm:before:hidden" : "shrink-0 max-sm:hidden",
        className,
      )}
    >
      {children}
    </li>
  );
}

export function CrumbLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block max-w-40 truncate rounded-md px-1.5 py-1 pointer-coarse:py-3 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

/**
 * The bar every signed-in page opens under: the way Home and where this page
 * sits (`Home / folder / title`) on the left, then what the page offers and
 * who is signed in on the right. It shares the page gutter, so its left edge
 * lines up with the content's.
 *
 * `crumbs` are the folders and the title after Home, each a `Crumb`; without
 * any, Home is the current page. `wrapHome` lets a page make Home a target of
 * its own, as the dashboard does for dropping things back to the top.
 */
export function AppBar({
  account,
  crumbs,
  wrapHome = (home) => home,
  status,
  actions,
  back,
  className,
}: {
  /** Undefined while the page is still finding out who is signed in. */
  account: AppBarAccount | null | undefined;
  crumbs?: ReactNode;
  wrapHome?: (home: ReactNode) => ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  /**
   * Where a phone's compact bar goes back to. It takes the logo's place, and
   * the theme and account move into the page's own menu.
   */
  back?: { href: string; label: string };
  className?: string;
}) {
  const home = account === null ? "/" : "/dashboard";
  return (
    <header
      data-component-name="AppBar"
      className={cn(
        "flex h-(--app-bar-height) w-full shrink-0 items-center gap-2 border-b border-border bg-card text-sm",
        "pl-[max(--spacing(4),env(safe-area-inset-left))] pr-[max(--spacing(4),env(safe-area-inset-right))]",
        "sm:pl-[max(--spacing(6),env(safe-area-inset-left))] sm:pr-[max(--spacing(6),env(safe-area-inset-right))]",
        "lg:pl-[max(--spacing(8),env(safe-area-inset-left))] lg:pr-[max(--spacing(8),env(safe-area-inset-right))]",
        className,
      )}
    >
      {back && (
        <Link
          href={back.href}
          aria-label={back.label}
          className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11 sm:hidden"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
        </Link>
      )}
      <Link
        href={home}
        aria-label="Lexidraw"
        className={cn(
          "flex shrink-0 items-center justify-center gap-1.5 rounded-md text-foreground pointer-coarse:h-11 pointer-coarse:min-w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          back && "max-sm:hidden",
        )}
      >
        <AppIcon aria-hidden className="size-6" />
        <span className="font-brand text-lg max-lg:hidden">Lexidraw</span>
      </Link>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 sm:pl-2">
        <ol className="flex min-w-0 items-center">
          <Crumb current={!crumbs}>
            {wrapHome(
              <Link
                href={home}
                aria-current={crumbs ? undefined : "page"}
                className={cn(
                  "block rounded-md px-1.5 py-1 pointer-coarse:py-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  crumbs
                    ? "text-muted-foreground hover:text-foreground"
                    : "font-medium text-foreground",
                )}
              >
                Home
              </Link>,
            )}
          </Crumb>
          {crumbs}
        </ol>
      </nav>
      <div className="flex shrink-0 items-center gap-1">
        {status}
        {actions}
        <div className={cn("flex items-center gap-1", back && "max-sm:hidden")}>
          <ModeToggle />
          <AccountMenu account={account} />
        </div>
      </div>
    </header>
  );
}
