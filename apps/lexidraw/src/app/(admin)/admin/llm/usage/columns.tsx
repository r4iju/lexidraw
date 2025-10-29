"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "~/components/admin/data-table/column-header";

export type UsageRow = {
  id: string;
  createdAt: Date;
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

export const usageColumns: ColumnDef<UsageRow>[] = [
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Time" />
    ),
    cell: ({ row }) => (
      <div>{new Date(row.original.createdAt).toLocaleString()}</div>
    ),
    sortingFn: "alphanumeric",
  },
  {
    accessorKey: "requestId",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Request" />
    ),
    cell: ({ row }) => (
      <div className="font-mono text-xs">{row.original.requestId}</div>
    ),
  },
  {
    id: "user",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="User" />
    ),
    cell: ({ row }) => (
      <div>{row.original.userEmail ?? row.original.userId}</div>
    ),
  },
  {
    accessorKey: "entityId",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Entity" />
    ),
    cell: ({ row }) => <div>{row.original.entityId ?? "—"}</div>,
  },
  {
    accessorKey: "mode",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Mode" />
    ),
  },
  {
    id: "providerModel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Provider/Model" />
    ),
    cell: ({ row }) => (
      <div>
        {row.original.provider}/{row.original.modelId}
      </div>
    ),
  },
  {
    accessorKey: "totalTokens",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Tokens" />
    ),
    cell: ({ row }) => <div>{row.original.totalTokens ?? "—"}</div>,
  },
  {
    accessorKey: "latencyMs",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Latency" />
    ),
    cell: ({ row }) => <div>{row.original.latencyMs} ms</div>,
  },
  {
    accessorKey: "route",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Route" />
    ),
  },
  {
    accessorKey: "errorCode",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Error" />
    ),
    cell: ({ row }) => <div>{row.original.errorCode ?? ""}</div>,
  },
];
