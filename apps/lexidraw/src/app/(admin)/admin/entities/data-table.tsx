"use client";
import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { entityColumns, type EntityRow } from "./columns";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "~/trpc/react";

export function EntitiesDataTable(props: {
  rows: EntityRow[];
  page: number;
  size: number;
  query: string;
  status: string;
  owners: { id: string; name: string | null; email: string | null }[];
  ownerId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [query, setQuery] = React.useState<string>(props.query ?? "");
  const [status, setStatus] = React.useState<string>(props.status ?? "");
  const [ownerId, setOwnerId] = React.useState<string>(props.ownerId ?? "");
  const [pageIndex, setPageIndex] = React.useState(props.page - 1);
  const pageSize = props.size;

  const table = useReactTable({
    data: props.rows,
    columns: entityColumns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { sorting },
    manualPagination: true,
  });

  const updateUrl = React.useCallback(
    (next: {
      page?: number;
      size?: number;
      query?: string;
      status?: string;
      ownerId?: string;
    }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next.page !== undefined) params.set("page", String(next.page));
      if (next.size !== undefined) params.set("size", String(next.size));
      if (next.query !== undefined)
        next.query ? params.set("query", next.query) : params.delete("query");
      if (next.status !== undefined)
        next.status
          ? params.set("status", next.status)
          : params.delete("status");
      if (next.ownerId !== undefined)
        next.ownerId
          ? params.set("ownerId", next.ownerId)
          : params.delete("ownerId");
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  React.useEffect(() => {
    updateUrl({ page: pageIndex + 1, size: pageSize, query, status, ownerId });
  }, [pageIndex, pageSize, query, status, ownerId, updateUrl]);

  const exportCsv = api.adminEntities.exportCsv.useMutation();

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 py-4">
        <Input
          placeholder="Search title..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="border bg-background px-2 py-1 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          className="border bg-background px-2 py-1 text-sm"
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
        >
          <option value="">All owners</option>
          {props.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {(o.name ?? o.email ?? o.id) as string}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={async () => {
            const csv = await exportCsv.mutateAsync({
              query,
              ownerId,
              status: status as "active" | "inactive" | undefined,
            });
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "entities.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export CSV
        </Button>
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
                  colSpan={entityColumns.length}
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
