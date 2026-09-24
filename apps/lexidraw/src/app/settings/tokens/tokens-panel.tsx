"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { LocalTime } from "~/components/ui/local-time";

type TokenRow = RouterOutputs["tokens"]["list"][number];
type Scope = "read" | "write";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
] as const;

function formatDate(value: Date | null) {
  return value ? <LocalTime value={value} /> : "—";
}

function tokenStatus(row: TokenRow): "active" | "revoked" | "expired" {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return "expired";
  return "active";
}

export function TokensPanel({ tokens }: { tokens: TokenRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("read");
  const [expiry, setExpiry] = useState<string>("90");
  const [created, setCreated] = useState<{
    name: string;
    token: string;
  } | null>(null);

  const create = api.tokens.create.useMutation({
    onSuccess: (result) => {
      setCreated({ name: result.name, token: result.token });
      setName("");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = api.tokens.revoke.useMutation({
    onSuccess: () => {
      toast.success("Token revoked");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate({
      name,
      scope,
      expiresInDays: expiry === "never" ? null : Number(expiry),
    });
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.token);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={submit}
        className="grid gap-3 md:grid-cols-[1fr_140px_140px_auto] md:items-end"
      >
        <div className="grid gap-1">
          <Label htmlFor="token-name">Name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. laptop CLI"
            maxLength={64}
            required
          />
        </div>
        <div className="grid gap-1">
          <Label>Scope</Label>
          <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <SelectTrigger aria-label="Scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="read">Read</SelectItem>
              <SelectItem value="write">Read and write</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Expires</Label>
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger aria-label="Expiry">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          Create token
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No tokens yet.
              </TableCell>
            </TableRow>
          ) : (
            tokens.map((row) => {
              const status = tokenStatus(row);
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.scope}</TableCell>
                  <TableCell>{status}</TableCell>
                  <TableCell>{formatDate(row.expiresAt)}</TableCell>
                  <TableCell>{formatDate(row.lastUsedAt)}</TableCell>
                  <TableCell className="text-right">
                    {status === "active" ? (
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

      <Dialog
        open={created !== null}
        onOpenChange={(open) => !open && setCreated(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token created</DialogTitle>
            <DialogDescription>
              Copy the token for “{created?.name}” now. It will not be shown
              again.
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded border-border border bg-muted p-3 text-sm">
            {created?.token}
          </code>
          <DialogFooter>
            <Button variant="outline" onClick={copy}>
              Copy
            </Button>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
