"use client";

import * as React from "react";
import {
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { ChevronDown } from "lucide-react";
import { usageColumns, type UsageRow } from "./columns";
import { useRouter, useSearchParams } from "next/navigation";

export function UsageDataTable(props: {
  rows: UsageRow[];
  page: number;
  size: number;
  routeFilter: string;
  modelFilter: string;
  sort: string | undefined;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sorting, setSorting] = React.useState<SortingState>(() => {
    const s = props.sort;
    if (!s) return [];
    const [id, dir] = s.split(".");
    if (!id) return [];
    return [{ id, desc: dir === "desc" }];
  });
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [routeFilter, setRouteFilter] = React.useState<string>(
    props.routeFilter ?? "",
  );
  const [modelFilter, setModelFilter] = React.useState<string>(
    props.modelFilter ?? "",
  );
  const [pageIndex, setPageIndex] = React.useState(props.page - 1);
  const pageSize = props.size;

  const serverRows: UsageRow[] = React.useMemo(() => {
    if (!modelFilter) return props.rows;
    return props.rows.filter((r) =>
      r.modelId.toLowerCase().includes(modelFilter.toLowerCase()),
    );
  }, [props.rows, modelFilter]);

  const table = useReactTable({
    data: serverRows,
    columns: usageColumns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
    manualPagination: true,
    pageCount: undefined,
  });

  const updateUrl = React.useCallback(
    (next: {
      page?: number;
      size?: number;
      route?: string;
      model?: string;
      sort?: string;
    }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next.page !== undefined) params.set("page", String(next.page));
      if (next.size !== undefined) params.set("size", String(next.size));
      if (next.route !== undefined) {
        if (next.route) params.set("route", next.route);
        else params.delete("route");
      }
      if (next.model !== undefined) {
        if (next.model) params.set("model", next.model);
        else params.delete("model");
      }
      if (next.sort !== undefined) {
        if (next.sort) params.set("sort", next.sort);
        else params.delete("sort");
      }
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  React.useEffect(() => {
    updateUrl({
      page: pageIndex + 1,
      size: pageSize,
      route: routeFilter,
      model: modelFilter,
      sort: sorting[0]
        ? `${sorting[0].id}.${sorting[0].desc ? "desc" : "asc"}`
        : undefined,
    });
    // Only trigger when user changes these locally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, pageSize, routeFilter, modelFilter, sorting, updateUrl]);

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 py-4">
        <Input
          placeholder="Filter by route..."
          value={routeFilter}
          onChange={(e) => setRouteFilter(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder="Filter by modelId..."
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          className="max-w-xs"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ml-auto">
              Columns <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter(
                (column) =>
                  typeof column.accessorFn !== "undefined" &&
                  column.getCanHide(),
              )
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
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
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
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
                  colSpan={usageColumns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="text-muted-foreground mt-2 flex justify-between text-sm">
        <div>Showing page {pageIndex + 1}</div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
            disabled={pageIndex === 0}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex(pageIndex + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
