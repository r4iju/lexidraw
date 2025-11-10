"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  thumbnailJobColumns,
  type ThumbnailJobRow,
} from "./columns";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectItem,
  SelectContent,
  SelectValue,
  SelectTrigger,
} from "~/components/ui/select";

export function ThumbnailJobsDataTable(props: {
  rows: ThumbnailJobRow[];
  page: number;
  size: number;
  status: "pending" | "processing" | "done" | "error" | "stale" | "all";
  sortBy: string;
  sortOrder: "asc" | "desc";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sorting, setSorting] = React.useState<SortingState>(() => {
    if (props.sortBy) {
      return [
        {
          id: props.sortBy,
          desc: props.sortOrder === "desc",
        },
      ];
    }
    return [];
  });
  const [status, setStatus] = React.useState<
    "pending" | "processing" | "done" | "error" | "stale" | "all"
  >(props.status ?? "all");

  const table = useReactTable({
    data: props.rows,
    columns: thumbnailJobColumns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    manualSorting: true,
  });

  const updateUrl = React.useCallback(
    (next: {
      page?: number;
      size?: number;
      status?: "pending" | "processing" | "done" | "error" | "stale" | "all";
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    }) => {
      const current = new URLSearchParams(searchParams?.toString() ?? "");
      const nextParams = new URLSearchParams(current.toString());
      if (next.page !== undefined) nextParams.set("page", String(next.page));
      if (next.size !== undefined) nextParams.set("size", String(next.size));
      if (next.status !== undefined)
        next.status !== "all"
          ? nextParams.set("status", next.status)
          : nextParams.delete("status");
      if (next.sortBy !== undefined)
        next.sortBy
          ? nextParams.set("sortBy", next.sortBy)
          : nextParams.delete("sortBy");
      if (next.sortOrder !== undefined)
        next.sortOrder
          ? nextParams.set("sortOrder", next.sortOrder)
          : nextParams.delete("sortOrder");
      const currentStr = `?${current.toString()}`;
      const nextStr = `?${nextParams.toString()}`;
      if (nextStr !== currentStr) {
        router.replace(nextStr);
      }
    },
    [router, searchParams],
  );

  React.useEffect(() => {
    const currentSort = sorting[0];
    updateUrl({
      page: props.page,
      size: props.size,
      status: status,
      sortBy: currentSort?.id,
      sortOrder: currentSort?.desc ? "desc" : "asc",
    });
  }, [sorting, status, props.page, props.size, updateUrl]);

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 py-4">
        <Select
          value={status}
          onValueChange={(value) =>
            setStatus(
              value as
                | "pending"
                | "processing"
                | "done"
                | "error"
                | "stale"
                | "all",
            )
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={
                      header.id === "actions" ? "text-right" : undefined
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={
                        cell.column.id === "actions" ? "text-right" : undefined
                      }
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={thumbnailJobColumns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No jobs found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

