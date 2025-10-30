"use client";

import { Shield } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { AdminMenuContent } from "./admin-menu-content";

/**
 * Approach B: Separate admin icon button next to user icon
 */
export function HeaderAdminIconButton() {
  return (
    <li>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon">
            <Shield className="h-[1.2rem] w-[1.2rem]" />
            <span className="sr-only">Administration</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <AdminMenuContent />
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
