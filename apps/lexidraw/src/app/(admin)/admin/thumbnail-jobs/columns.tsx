"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import Link from "next/link";
import { RowActions } from "./row-actions";
import { DataTableColumnHeader } from "~/components/admin/data-table/column-header";

export type ThumbnailJobRow = {
  id: string;
  entityId: string;
  version: string;
  status: "pending" | "processing" | "done" | "error" | "stale";
  attempts: number;
  nextRunAt: Date | number | null;
  lastError: string | null;
  createdAt: Date | number;
  updatedAt: Date | number;
};

function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return `${str.slice(0, length)}...`;
}

function formatDate(date: Date | number | null | undefined): string {
  if (!date) return "-";
  const dateObj = date instanceof Date ? date : new Date(date);
  return format(dateObj, "yyyy-MM-dd HH:mm:ss");
}

function getStatusColor(status: string): string {
  switch (status) {
    case "pending":
      return "text-yellow-600";
    case "processing":
      return "text-blue-600";
    case "done":
      return "text-green-600";
    case "error":
      return "text-red-600";
    case "stale":
      return "text-gray-600";
    default:
      return "";
  }
}

export const thumbnailJobColumns: ColumnDef<ThumbnailJobRow>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Job ID" />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-xs">{truncate(row.original.id, 12)}</span>
    ),
  },
  {
    accessorKey: "entityId",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Entity ID" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/admin/entities?query=${row.original.entityId}`}
        className="font-mono text-xs text-blue-600 hover:underline"
      >
        {truncate(row.original.entityId, 12)}
      </Link>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <span className={getStatusColor(row.original.status)}>
        {row.original.status}
      </span>
    ),
  },
  {
    accessorKey: "attempts",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Attempts" />
    ),
    cell: ({ row }) => row.original.attempts,
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created At" />
    ),
    cell: ({ row }) => (
      <span className="text-xs">{formatDate(row.original.createdAt)}</span>
    ),
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Updated At" />
    ),
    cell: ({ row }) => (
      <span className="text-xs">{formatDate(row.original.updatedAt)}</span>
    ),
  },
  {
    accessorKey: "nextRunAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Next Run At" />
    ),
    cell: ({ row }) => (
      <span className="text-xs">{formatDate(row.original.nextRunAt)}</span>
    ),
  },
  {
    accessorKey: "lastError",
    header: "Last Error",
    cell: ({ row }) => {
      const error = row.original.lastError;
      return error ? (
        <span className="max-w-xs truncate text-xs" title={error}>
          {truncate(error, 50)}
        </span>
      ) : (
        "-"
      );
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RowActions job={row.original} />,
  },
];

