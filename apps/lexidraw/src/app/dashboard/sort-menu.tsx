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
import { replaceSearchParam } from "./utils";

export function SortMenu() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const sortBy = searchParams.get("sortBy") ?? "updatedAt";

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
