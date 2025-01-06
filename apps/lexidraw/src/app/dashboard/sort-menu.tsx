"use client";

import { ArrowUp, ArrowDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { TooltipButton } from "~/components/ui/tooltip-button";

type Props = {
  sortBy?: "updatedAt" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
};

export function SortMenu({ sortBy, sortOrder }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSort = (value: string) => {
    router.push(`${pathname}?sortBy=${value}&sortOrder=${sortOrder}`);
  };

  const handleSortOrder = () => {
    router.push(
      `${pathname}?sortBy=${sortBy}&sortOrder=${sortOrder === "asc" ? "desc" : "asc"}`,
    );
  };

  const tooltipText = (() => {
    switch (sortBy) {
      case "createdAt":
        return sortOrder === "asc" ? "Oldest first" : "Newest first";
      case "updatedAt":
        return sortOrder === "asc" ? "Oldest first" : "Newest first";
      case "title":
        return sortOrder === "asc" ? "A → Z" : "Z → A";
      default:
        return "Sort by";
    }
  })();

  return (
    <div className="flex justify-end items-center gap-2 px-2">
      <Select onValueChange={handleSort} defaultValue={sortBy}>
        <SelectTrigger className="w-[fit-content]">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updatedAt">Updated at</SelectItem>
          <SelectItem value="createdAt">Created at</SelectItem>
          <SelectItem value="title">Title</SelectItem>
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
