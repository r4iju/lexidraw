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
  const dashboardActive =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const profileActive =
    pathname === "/profile" || pathname.startsWith("/profile/");
  return (
    <>
      <DropdownMenuItem asChild>
        <Link
          className={cn(
            "cursor-default",
            dashboardActive && "bg-accent text-accent-foreground",
          )}
          href="/dashboard"
          aria-current={dashboardActive ? "page" : undefined}
        >
          My Drawings
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link
          className={cn(
            "cursor-default",
            profileActive && "bg-accent text-accent-foreground",
          )}
          href="/profile"
          aria-current={profileActive ? "page" : undefined}
        >
          Profile
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link
          className="cursor-default"
          href="/api/auth/signout?callbackUrl=/api/auth/session"
        >
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
