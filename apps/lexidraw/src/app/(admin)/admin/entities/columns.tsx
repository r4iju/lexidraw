"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { RowActions } from "./row-actions";

export type EntityRow = {
  id: string;
  title: string;
  ownerLabel: string;
  membersCount: number;
  isActive: number;
  createdAt: Date;
};

export const entityColumns: ColumnDef<EntityRow>[] = [
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
    cell: ({ row }) => format(row.original.createdAt, "yyyy-MM-dd"),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RowActions row={row.original} />,
  },
];
