"use client";

import { ArrowUp, ArrowDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { TooltipButton } from "~/components/ui/tooltip-button";
import { cn } from "~/lib/utils";
import { replaceSearchParam } from "./utils";

const ORDERS = {
  updatedAt: "Last edited",
  createdAt: "Date created",
  title: "Name",
} as const;

/** The listing's order, as the server resolved it from the address and prefs. */
export function SortMenu({
  sortBy,
  sortOrder,
  className,
}: {
  sortBy: keyof typeof ORDERS;
  sortOrder: "asc" | "desc";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const handleSort = (value: string) => {
    const newPath = replaceSearchParam({
      pathname,
      prevParams: searchParams,
      key: "sortBy",
      value,
    });
    router.push(newPath);
  };

  const handleSortOrder = () => {
    const newPath = replaceSearchParam({
      pathname,
      prevParams: searchParams,
      key: "sortOrder",
      value: sortOrder === "asc" ? "desc" : "asc",
    });
    router.push(newPath);
  };

  const tooltipText = (() => {
    switch (sortBy) {
      case "createdAt":
        return sortOrder === "asc" ? "Oldest first" : "Newest first";
      case "updatedAt":
        return sortOrder === "asc" ? "Oldest first" : "Recent first";
      case "title":
        return sortOrder === "asc" ? "A → Z" : "Z → A";
    }
  })();

  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      <Select onValueChange={handleSort} value={sortBy}>
        <SelectTrigger
          className="w-[fit-content] min-w-30"
          aria-label="Sort by"
        >
          {/* Named here, since the select only learns its items' names once
              it has mounted, and the server's HTML would say nothing. */}
          <SelectValue placeholder="Sort by">{ORDERS[sortBy]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ORDERS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* button to sort by order */}

      <TooltipButton
        variant="outline"
        onClick={handleSortOrder}
        disabled={false}
        title={`${tooltipText}`}
        ariaLabel={`Sorted by ${tooltipText}`}
        Icon={sortOrder === "asc" ? ArrowUp : ArrowDown}
      />
    </div>
  );
}
