"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";

/**
 * Shared admin menu content component used by both Approach A and B
 */
export function AdminMenuContent() {
  const pathname = usePathname();

  return (
    <>
      <DropdownMenuItem asChild>
        <Link
          className="cursor-default"
          href="/admin"
          data-active={pathname === "/admin"}
        >
          Overview
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>LLM</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem asChild>
            <Link
              className="cursor-default"
              href="/admin/llm"
              data-active={pathname === "/admin/llm"}
            >
              Overview
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              className="cursor-default"
              href="/admin/llm/policies"
              data-active={pathname === "/admin/llm/policies"}
            >
              Policies
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              className="cursor-default"
              href="/admin/llm/users"
              data-active={pathname === "/admin/llm/users"}
            >
              Users
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              className="cursor-default"
              href="/admin/llm/usage"
              data-active={pathname === "/admin/llm/usage"}
            >
              Usage
            </Link>
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem asChild>
        <Link
          className="cursor-default"
          href="/admin/users"
          data-active={pathname === "/admin/users"}
        >
          Users
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link
          className="cursor-default"
          href="/admin/entities"
          data-active={pathname === "/admin/entities"}
        >
          Entities
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link
          className="cursor-default"
          href="/admin/crons"
          data-active={pathname === "/admin/crons"}
        >
          Crons
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link
          className="cursor-default"
          href="/admin/backups"
          data-active={pathname === "/admin/backups"}
        >
          Backups
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link
          className="cursor-default"
          href="/admin/thumbnail-jobs"
          data-active={pathname === "/admin/thumbnail-jobs"}
        >
          Thumbnail Jobs
        </Link>
      </DropdownMenuItem>
    </>
  );
}
