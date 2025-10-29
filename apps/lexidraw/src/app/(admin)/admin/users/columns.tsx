"use client";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "~/components/ui/badge";
import { format } from "date-fns";
import { RowActions } from "./row-actions";

export type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  roles: string[];
  isActive: number;
  createdAt: Date;
  lastActive: Date | null;
  requests30d: number;
};

export const userColumns: ColumnDef<UserRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => row.original.name ?? "—",
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => row.original.email ?? "—",
  },
  {
    accessorKey: "roles",
    header: "Roles",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.roles.map((r) => (
          <Badge key={r} variant="secondary">
            {r}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => (row.original.isActive ? "Active" : "Inactive"),
  },
  {
    accessorKey: "requests30d",
    header: "Req (30d)",
  },
  {
    accessorKey: "lastActive",
    header: "Last Active",
    cell: ({ row }) =>
      row.original.lastActive
        ? format(row.original.lastActive, "yyyy-MM-dd")
        : "—",
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
