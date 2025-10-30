"use client";

import * as React from "react";
import {
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
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

import { api } from "~/trpc/react";
import { keepPreviousData } from "@tanstack/react-query";
import type { AllowedSortFields } from "./page";

type UsageApiRow = {
  id: string;
  createdAt: number | Date;
  requestId: string;
  userId: string;
  userEmail: string | null;
  entityId: string | null;
  mode: string;
  route: string;
  provider: string;
  modelId: string;
  totalTokens: number | null;
  latencyMs: number;
  errorCode: string | null;
  httpStatus: number | null;
};

export function UsageDataTable(props: {
  initialRawRows: UsageApiRow[];
  initialPage: number;
  initialSize: number;
  initialRoute: string;
  initialModel: string;
  initialSortField: (typeof AllowedSortFields)[number];
  initialSortOrder: "asc" | "desc";
}) {
  // URL sync removed for simplicity
  type ViewState = {
    sorting: SortingState;
    columnFilters: ColumnFiltersState;
    columnVisibility: VisibilityState;
    routeFilter: string;
    modelFilter: string;
    pageIndex: number;
  };

  const [viewState, setViewState] = React.useState<ViewState>(() => ({
    sorting: [
      { id: props.initialSortField, desc: props.initialSortOrder === "desc" },
    ],
    columnFilters: [],
    columnVisibility: {},
    routeFilter: props.initialRoute ?? "",
    modelFilter: props.initialModel ?? "",
    pageIndex: props.initialPage - 1,
  }));

  const setPageIndex = (updater: number | ((prev: number) => number)) => {
    setViewState((prev) => ({
      ...prev,
      pageIndex:
        typeof updater === "function"
          ? (updater as (p: number) => number)(prev.pageIndex)
          : updater,
    }));
  };

  const setRouteFilter = (value: string) => {
    setViewState((prev) => ({ ...prev, routeFilter: value }));
  };

  const setModelFilter = (value: string) => {
    setViewState((prev) => ({ ...prev, modelFilter: value }));
  };
  const pageSize = props.initialSize;

  const sortParam = viewState.sorting[0]
    ? `${viewState.sorting[0].id}.${viewState.sorting[0].desc ? "desc" : "asc"}`
    : undefined;

  const { data: apiRows, isFetching } = api.adminLlm.usage.list.useQuery(
    {
      page: viewState.pageIndex + 1,
      size: pageSize,
      route: viewState.routeFilter || undefined,
      sort: sortParam,
    },
    {
      placeholderData: keepPreviousData,
      staleTime: 5_000,
    },
  );

  const serverRows: UsageRow[] = React.useMemo(() => {
    const raw = apiRows ?? props.initialRawRows;
    const base = (raw ?? []).map((d) => {
      const createdAtMs =
        d.createdAt instanceof Date
          ? d.createdAt.getTime()
          : (d.createdAt as number);
      return {
        id: d.id,
        createdAt: new Date(createdAtMs),
        requestId: d.requestId,
        userId: d.userId,
        userEmail: d.userEmail ?? null,
        entityId: d.entityId ?? null,
        mode: d.mode,
        route: d.route,
        provider: d.provider,
        modelId: d.modelId,
        totalTokens: d.totalTokens ?? null,
        latencyMs: d.latencyMs,
        errorCode: d.errorCode ?? null,
        httpStatus: d.httpStatus ?? null,
      };
    });
    if (!viewState.modelFilter) return base;
    return base.filter((r) =>
      r.modelId.toLowerCase().includes(viewState.modelFilter.toLowerCase()),
    );
  }, [apiRows, props.initialRawRows, viewState.modelFilter]);

  const table = useReactTable({
    data: serverRows,
    columns: usageColumns,
    onSortingChange: (updater) =>
      setViewState((prev) => {
        const nextSorting =
          typeof updater === "function"
            ? (updater as (s: SortingState) => SortingState)(prev.sorting)
            : updater;
        return { ...prev, sorting: nextSorting, pageIndex: 0 };
      }),
    onColumnFiltersChange: (updater) =>
      setViewState((prev) => ({
        ...prev,
        columnFilters:
          typeof updater === "function"
            ? (updater as (s: ColumnFiltersState) => ColumnFiltersState)(
                prev.columnFilters,
              )
            : updater,
      })),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: (updater) =>
      setViewState((prev) => ({
        ...prev,
        columnVisibility:
          typeof updater === "function"
            ? (updater as (s: VisibilityState) => VisibilityState)(
                prev.columnVisibility,
              )
            : updater,
      })),
    getRowId: (row) => row.id,
    state: {
      sorting: viewState.sorting,
      columnFilters: viewState.columnFilters,
      columnVisibility: viewState.columnVisibility,
    },
    manualPagination: true,
    manualSorting: true,
  });

  // URL sync removed for simplicity

  // Props are only initial seeds; subsequent navigation stays client-side via useQuery

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 py-4">
        <Input
          placeholder="Filter by route..."
          value={viewState.routeFilter}
          onChange={(e) => setRouteFilter(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder="Filter by modelId..."
          value={viewState.modelFilter}
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
        <div>
          Showing page {viewState.pageIndex + 1}
          {isFetching ? (
            <span className="ml-2 opacity-70">refreshing…</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
            disabled={viewState.pageIndex === 0}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((prev) => prev + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
