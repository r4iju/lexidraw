"use client";
import type { ColumnDef } from "@tanstack/react-table";
import type { AdminTableFeatures } from "~/components/admin/data-table/features";
import { RowActions } from "./row-actions";
import { LocalTime } from "~/components/ui/local-time";

export type EntityRow = {
  id: string;
  title: string;
  ownerLabel: string;
  membersCount: number;
  isActive: number;
  createdAt: Date;
};

export const entityColumns: ColumnDef<AdminTableFeatures, EntityRow>[] = [
  { accessorKey: "title", header: "Title" },
  { accessorKey: "ownerLabel", header: "Owner" },
  { accessorKey: "membersCount", header: "Members" },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => (row.original.isActive ? "Active" : "Inactive"),
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <LocalTime value={row.original.createdAt} format="date" />
    ),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RowActions row={row.original} />,
  },
];
