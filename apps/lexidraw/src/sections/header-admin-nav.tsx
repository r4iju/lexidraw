"use client";

import { ChevronLeft } from "lucide-react";
import {
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { AdminMenuContent } from "./admin-menu-content";

/**
 * Approach A: Admin sub-menu in user dropdown
 */
export function HeaderAdminNav() {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger chevronClassName="hidden">
          <ChevronLeft className="h-4 w-4" />
          <span>Administration</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <AdminMenuContent />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
