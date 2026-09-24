"use client";

import Link from "next/link";
import { cn } from "~/lib/utils";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { usePathname } from "next/navigation";

export const SessionedDropdown = () => {
  const pathname = usePathname();
  const homeActive =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const settingsActive = pathname.startsWith("/settings");
  return (
    <>
      <DropdownMenuItem asChild>
        <Link
          className={cn(
            "cursor-default",
            homeActive && "bg-accent text-accent-foreground",
          )}
          href="/dashboard"
          aria-current={homeActive ? "page" : undefined}
        >
          Home
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link
          className={cn(
            "cursor-default",
            settingsActive && "bg-accent text-accent-foreground",
          )}
          href="/settings"
          aria-current={settingsActive ? "page" : undefined}
        >
          Settings
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link className="cursor-default" href="/signout">
          Sign out
        </Link>
      </DropdownMenuItem>
    </>
  );
};

export const UnsessionedDropdown = () => {
  return (
    <>
      <DropdownMenuItem asChild>
        <Link className="cursor-default" href="/signin">
          Sign in
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link className="cursor-default" href="/signup">
          Create account
        </Link>
      </DropdownMenuItem>
    </>
  );
};
