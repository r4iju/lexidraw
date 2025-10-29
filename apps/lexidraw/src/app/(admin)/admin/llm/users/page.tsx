import Link from "next/link";
import { api } from "~/trpc/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export default async function AdminLlmUsersPage() {
  type AdminUserRow = {
    id: string;
    name: string;
    email: string | null;
    tokens30d: number;
    requests30d: number;
    lastActive: number;
  };
  const users = (await api.adminLlm.users.list.query({
    page: 1,
    size: 50,
  })) as AdminUserRow[];
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border p-4 text-sm font-medium">
        Users
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="p-3">Name</TableHead>
              <TableHead className="p-3">Email</TableHead>
              <TableHead className="p-3">Tokens (30d)</TableHead>
              <TableHead className="p-3">Requests (30d)</TableHead>
              <TableHead className="p-3">Last active</TableHead>
              <TableHead className="p-3">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="p-3">{u.name}</TableCell>
                <TableCell className="p-3">{u.email ?? ""}</TableCell>
                <TableCell className="p-3">
                  {Number(u.tokens30d ?? 0).toLocaleString()}
                </TableCell>
                <TableCell className="p-3">
                  {Number(u.requests30d ?? 0)}
                </TableCell>
                <TableCell className="p-3">
                  {u.lastActive
                    ? new Date(Number(u.lastActive)).toLocaleString()
                    : "—"}
                </TableCell>
                <TableCell className="p-3">
                  <Link
                    href={`/admin/llm/users/${u.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
