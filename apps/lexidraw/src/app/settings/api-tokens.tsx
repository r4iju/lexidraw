"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { LocalTime } from "~/components/ui/local-time";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";

type TokenRow = Pick<
  RouterOutputs["tokens"]["list"][number],
  "id" | "name" | "scope" | "expiresAt" | "lastUsedAt" | "revokedAt"
>;
type Scope = "read" | "write";
type CreateInput = {
  name: string;
  scope: Scope;
  expiresInDays: number | null;
};

const CLI_SETUP_URL =
  "https://github.com/r4iju/lexidraw/blob/master/skills/lexidraw/SKILL.md#setup";

const SCOPE_LABEL: Record<Scope, string> = {
  read: "Read",
  write: "Read and write",
};

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
] as const;

function isExpired(row: TokenRow) {
  return row.expiresAt !== null && row.expiresAt.getTime() < Date.now();
}

function TokenItem({
  row,
  onRevoke,
}: {
  row: TokenRow;
  onRevoke?: (row: TokenRow) => void;
}) {
  const status = row.revokedAt
    ? "Revoked"
    : isExpired(row)
      ? "Expired"
      : "Active";
  return (
    <li
      data-token={row.id}
      className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate font-medium">{row.name}</p>
        <p className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          <span>{SCOPE_LABEL[row.scope as Scope] ?? row.scope}</span>
          <span aria-hidden="true">·</span>
          <span>{status}</span>
          <span aria-hidden="true">·</span>
          <span>
            {row.lastUsedAt ? (
              <>
                Last used <LocalTime value={row.lastUsedAt} format="relative" />
              </>
            ) : (
              "Never used"
            )}
          </span>
          {!row.revokedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {row.expiresAt ? (
                  <>
                    {status === "Expired" ? "Expired" : "Expires"}{" "}
                    <LocalTime value={row.expiresAt} format="relative" />
                  </>
                ) : (
                  "Never expires"
                )}
              </span>
            </>
          )}
        </p>
      </div>
      {onRevoke && (
        <Button
          variant="outline"
          size="sm"
          className="self-start sm:self-center"
          onClick={() => onRevoke(row)}
        >
          Revoke
        </Button>
      )}
    </li>
  );
}

export function ApiTokens({
  tokens,
  onCreate,
  onRevoke,
}: {
  tokens: TokenRow[];
  onCreate: (input: CreateInput) => Promise<{ name: string; token: string }>;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("read");
  const [expiry, setExpiry] = useState<string>("90");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{
    name: string;
    token: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<TokenRow | null>(null);

  const current = tokens.filter((row) => !row.revokedAt);
  const revoked = tokens.filter((row) => row.revokedAt);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      setCreated(
        await onCreate({
          name: name.trim(),
          scope,
          expiresInDays: expiry === "never" ? null : Number(expiry),
        }),
      );
      setCopied(false);
      setName("");
    } catch {
      // The caller has said what went wrong; the form keeps what was typed.
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.token);
    setCopied(true);
  };

  const confirmRevoke = async () => {
    if (!revoking) return;
    const { id } = revoking;
    setRevoking(null);
    await onRevoke(id);
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Let the Lexidraw CLI and AI agents work with your files as you.{" "}
        <a
          href={CLI_SETUP_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Set up the CLI
        </a>
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="token-name">Name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="For example, laptop"
            maxLength={64}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="token-scope">Access</Label>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as Scope)}
            >
              <SelectTrigger id="token-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{SCOPE_LABEL.read}</SelectItem>
                <SelectItem value="write">{SCOPE_LABEL.write}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="token-expiry">Expires after</Label>
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger id="token-expiry">
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
        </div>
        <p className="text-sm text-muted-foreground">
          Read: list and open your files. Read and write: also create, edit and
          delete them.
        </p>
        <Button
          type="submit"
          className="self-start"
          disabled={creating || !name.trim()}
        >
          Create token
        </Button>
      </form>

      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tokens yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {current.map((row) => (
            <TokenItem
              key={row.id}
              row={row}
              onRevoke={isExpired(row) ? undefined : setRevoking}
            />
          ))}
        </ul>
      )}

      {revoked.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            Revoked ({revoked.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {revoked.map((row) => (
              <TokenItem key={row.id} row={row} />
            ))}
          </ul>
        </details>
      )}

      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="leading-snug">
              Revoke “{revoking?.name}”?
            </DialogTitle>
            <DialogDescription>
              Anything using this token stops working right away. You can’t undo
              this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="destructive-confirm" onClick={confirmRevoke}>
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={created !== null}
        onOpenChange={(open) => !open && setCreated(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your new token</DialogTitle>
            <DialogDescription>
              This is the only time “{created?.name}” is shown. Store it
              somewhere safe, such as your password manager.
            </DialogDescription>
          </DialogHeader>
          <code className="block [overflow-wrap:anywhere] rounded-md border border-border bg-muted p-3 text-sm">
            {created?.token}
          </code>
          <DialogFooter>
            <Button variant="outline" className="gap-2" onClick={copy}>
              {copied ? (
                <CheckIcon className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The tokens list, wired to the server. */
export function ApiTokensSection({ tokens }: { tokens: TokenRow[] }) {
  const router = useRouter();
  const create = api.tokens.create.useMutation();
  const revoke = api.tokens.revoke.useMutation();

  return (
    <section
      id="api-tokens"
      aria-labelledby="api-tokens-heading"
      className="flex scroll-mt-[calc(var(--app-bar-height)+1rem)] flex-col gap-1"
    >
      <h2 id="api-tokens-heading" className="text-lg font-semibold">
        API tokens
      </h2>
      <ApiTokens
        tokens={tokens}
        onCreate={async (input) => {
          try {
            const result = await create.mutateAsync(input);
            router.refresh();
            return result;
          } catch (error) {
            toast.error(`Couldn’t create “${input.name}”. Try again.`, {
              description: error instanceof Error ? error.message : undefined,
            });
            throw error;
          }
        }}
        onRevoke={async (id) => {
          const name = tokens.find((row) => row.id === id)?.name;
          try {
            await revoke.mutateAsync({ id });
            toast.success(`Revoked “${name}”.`);
            router.refresh();
          } catch (error) {
            toast.error(`Couldn’t revoke “${name}”. Try again.`, {
              description: error instanceof Error ? error.message : undefined,
            });
          }
        }}
      />
    </section>
  );
}
