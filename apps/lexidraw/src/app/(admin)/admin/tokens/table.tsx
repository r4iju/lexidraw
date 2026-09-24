"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { LocalTime } from "~/components/ui/local-time";

type Row = RouterOutputs["adminTokens"]["list"][number];

function formatDate(value: Date | null) {
  return value ? <LocalTime value={value} /> : "—";
}

function status(row: Row): "active" | "revoked" | "expired" {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return "expired";
  return "active";
}

export function AdminTokensTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const revoke = api.adminTokens.revoke.useMutation({
    onSuccess: () => {
      toast.success("Token revoked");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Created</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="text-muted-foreground">
              No tokens.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const s = status(row);
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{row.userName}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.userEmail}
                    </span>
                  </div>
                </TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.scope}</TableCell>
                <TableCell>{s}</TableCell>
                <TableCell>{formatDate(row.expiresAt)}</TableCell>
                <TableCell>{formatDate(row.lastUsedAt)}</TableCell>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {s === "active" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate({ id: row.id })}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
