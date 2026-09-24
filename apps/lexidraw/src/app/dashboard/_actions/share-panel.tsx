"use client";

import { AccessLevel, PublicAccess } from "@packages/types";
import { LinkIcon, LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

const ROLE_LABEL: Record<AccessLevel, string> = {
  [AccessLevel.READ]: "Can view",
  [AccessLevel.EDIT]: "Can edit",
};

/** In the order people weigh them: closed, then open to read, then to edit. */
const GENERAL_ACCESS = [
  {
    value: PublicAccess.PRIVATE,
    label: "Restricted",
    consequence: "Only the people listed above can open it.",
  },
  {
    value: PublicAccess.READ,
    label: "Anyone with the link can view",
    consequence:
      "Anyone with the link can view it, without signing in. Only the people listed above can edit.",
  },
  {
    value: PublicAccess.EDIT,
    label: "Anyone with the link can edit",
    consequence:
      "Anyone with the link can view and change it, without signing in.",
  },
] as const;

const REMOVE = "remove";

export type SharePerson = {
  userId: string;
  name: string | null;
  email: string | null;
  accessLevel: AccessLevel;
  /** Added, but the server hasn't answered yet. */
  pending?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: { title: string; entityType: string };
  /** The person looking at the dialog: the owner, or someone it's shared with. */
  you: {
    name: string | null;
    email: string | null;
    role: "owner" | AccessLevel;
  };
  people: SharePerson[];
  publicAccess: PublicAccess;
  onPublicAccessChange: (access: PublicAccess) => void;
  onInvite: (email: string, accessLevel: AccessLevel) => void;
  inviting: boolean;
  inviteError: string | null;
  onRoleChange: (userId: string, accessLevel: AccessLevel) => void;
  onRemove: (userId: string) => void;
  onCopyLink: () => void;
};

function Avatar({ name }: { name: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium"
    >
      {(name ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SharePanel({
  open,
  onOpenChange,
  entity,
  you,
  people,
  publicAccess,
  onPublicAccessChange,
  onInvite,
  inviting,
  inviteError,
  onRoleChange,
  onRemove,
  onCopyLink,
}: Props) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [inviteLevel, setInviteLevel] = useState<AccessLevel>(AccessLevel.READ);
  const isOwner = you.role === "owner";
  const general =
    GENERAL_ACCESS.find((option) => option.value === publicAccess) ??
    GENERAL_ACCESS[0];

  const invite = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    onInvite(trimmed, inviteLevel);
    setEmail("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="break-normal md:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          emailRef.current?.focus();
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-8 leading-snug">
            Share “{entity.title}”
          </DialogTitle>
          <DialogDescription>
            People need a Lexidraw account to be added.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={invite} className="flex flex-col gap-1.5">
          <Label htmlFor="share-email">Add people</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={emailRef}
              id="share-email"
              type="email"
              autoComplete="off"
              placeholder="Email of a Lexidraw user"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={inviteError ? true : undefined}
              aria-describedby={inviteError ? "share-email-error" : undefined}
              className="min-w-0 flex-1"
            />
            <div className="flex gap-2">
              <Select
                value={inviteLevel}
                onValueChange={(value) => setInviteLevel(value as AccessLevel)}
              >
                <SelectTrigger
                  aria-label="Role for new people"
                  className="w-32"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AccessLevel.READ}>
                    {ROLE_LABEL[AccessLevel.READ]}
                  </SelectItem>
                  <SelectItem value={AccessLevel.EDIT}>
                    {ROLE_LABEL[AccessLevel.EDIT]}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="submit"
                className="gap-2"
                disabled={inviting || !email.trim()}
              >
                {inviting && (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                )}
                Share
              </Button>
            </div>
          </div>
          {inviteError && (
            <p
              id="share-email-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {inviteError}
            </p>
          )}
        </form>

        <section aria-labelledby="share-people" className="flex flex-col gap-2">
          <h3 id="share-people" className="text-sm font-semibold">
            People with access
          </h3>
          <ul className="flex flex-col gap-2">
            <li data-share-person="you" className="flex items-center gap-3">
              <Avatar name={you.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  You ·{" "}
                  {isOwner ? "Owner" : ROLE_LABEL[you.role as AccessLevel]}
                </p>
                {you.email && (
                  <p className="truncate text-sm text-muted-foreground">
                    {you.email}
                  </p>
                )}
              </div>
            </li>
            {people.map((person) => (
              <li
                key={person.userId}
                data-share-person={person.userId}
                className="flex items-center gap-3"
              >
                <Avatar name={person.name ?? person.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {person.name ?? person.email}
                  </p>
                  {person.email && person.name && (
                    <p className="truncate text-sm text-muted-foreground">
                      {person.email}
                    </p>
                  )}
                </div>
                <Select
                  value={person.accessLevel}
                  disabled={!isOwner || person.pending}
                  onValueChange={(value) =>
                    value === REMOVE
                      ? onRemove(person.userId)
                      : onRoleChange(person.userId, value as AccessLevel)
                  }
                >
                  <SelectTrigger
                    aria-label={`Access for ${person.name ?? person.email}`}
                    className="w-32 shrink-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value={AccessLevel.READ}>
                      {ROLE_LABEL[AccessLevel.READ]}
                    </SelectItem>
                    <SelectItem value={AccessLevel.EDIT}>
                      {ROLE_LABEL[AccessLevel.EDIT]}
                    </SelectItem>
                    <SelectSeparator />
                    <SelectItem
                      value={REMOVE}
                      className="text-destructive focus:text-destructive"
                    >
                      Remove access
                    </SelectItem>
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="share-general"
          className="flex flex-col gap-1.5"
        >
          <h3 id="share-general" className="text-sm font-semibold">
            General access
          </h3>
          <Select
            value={publicAccess}
            disabled={!isOwner}
            onValueChange={(value) =>
              onPublicAccessChange(value as PublicAccess)
            }
          >
            <SelectTrigger
              aria-label="General access"
              className="w-full sm:w-72"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENERAL_ACCESS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">{general.consequence}</p>
          {entity.entityType === "directory" && (
            <p className="text-sm text-muted-foreground">
              Sharing a folder doesn’t share the files in it. Share each file
              you want people to open.
            </p>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" className="gap-2" onClick={onCopyLink}>
            <LinkIcon className="size-4" />
            Copy link
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
