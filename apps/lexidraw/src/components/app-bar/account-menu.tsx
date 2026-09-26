"use client";

import { UserIcon } from "lucide-react";
import Link from "next/link";
import { ThemeRadioItems } from "~/components/theme/dark-mode-toggle";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { AdminMenuContent } from "~/sections/admin-menu-content";

export type AppBarAccount = {
  id: string;
  name: string | null;
  email: string | null;
  isAdmin: boolean;
};

function initials(account: AppBarAccount) {
  const source = account.name?.trim() || account.email || "";
  const letters = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return letters || null;
}

/** Who is signed in, and where they can go from anywhere. */
export function AccountMenu({
  account,
}: {
  /** Undefined while it is still being looked up. */
  account: AppBarAccount | null | undefined;
}) {
  if (account === undefined)
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Account"
        disabled
        className="size-9 rounded-full"
      >
        <span aria-hidden className="size-7 rounded-full bg-muted" />
      </Button>
    );
  if (!account)
    return (
      <Button asChild variant="ghost" size="sm" className="h-9 px-3">
        <Link href="/signin">Sign in</Link>
      </Button>
    );
  const letters = initials(account);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Account"
          title="Account"
          className="size-9 rounded-full"
        >
          {letters ? (
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
            >
              {letters}
            </span>
          ) : (
            <UserIcon className="size-5" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          {account.name && (
            <span className="truncate font-medium text-foreground">
              {account.name}
            </span>
          )}
          {account.email && (
            <span className="truncate text-muted-foreground">
              {account.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard">Home</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/trash">Trash</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ThemeRadioItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {account.isAdmin && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Administration</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <AdminMenuContent />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/signout">Sign out</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
