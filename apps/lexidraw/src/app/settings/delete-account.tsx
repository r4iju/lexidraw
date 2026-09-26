"use client";

import { signOut } from "next-auth/react";
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
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";
import { confirmsDeletion, deletionConfirmation } from "./schema";

type Account = { email: string | null; name: string };

/** Lives inside the dialog's content, so closing the dialog clears it. */
function ConfirmDeletion({ account }: { account: Account }) {
  const [typed, setTyped] = useState("");
  const remove = api.auth.deleteAccount.useMutation();
  const expected = deletionConfirmation(account);
  const confirmed = confirmsDeletion(account, typed);
  // Stays busy after the account is gone, while signing out leaves the page.
  const busy = remove.isPending || remove.isSuccess;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    try {
      await remove.mutateAsync({ confirmation: typed });
    } catch (error) {
      toast.error("Couldn’t delete your account. Try again.", {
        description: error instanceof Error ? error.message : undefined,
      });
      return;
    }
    await signOut({ callbackUrl: "/" });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogDescription>
          Your files, tokens and sign-ins are removed for good, for you and for
          everyone you shared with. You can’t undo this.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="delete-account-confirmation">
          Type <span className="font-semibold">{expected}</span> to confirm
        </Label>
        <Input
          id="delete-account-confirmation"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="submit"
          variant="destructive-confirm"
          disabled={!confirmed || busy}
          pending={busy}
        >
          Delete account
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DeleteAccountSection({ account }: { account: Account }) {
  return (
    <section
      id="delete-account"
      aria-labelledby="delete-account-heading"
      className="flex scroll-mt-[calc(var(--app-bar-height)+1rem)] flex-col gap-1"
    >
      <h2 id="delete-account-heading" className="text-lg font-semibold">
        Delete account
      </h2>
      <p className="text-sm text-muted-foreground">
        Remove your account and everything that is yours, for good.
      </p>
      <div className="mt-5 flex flex-col gap-4">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            Every file and folder you own, with the pictures, videos and audio
            in them. The people you shared them with can no longer open them.
          </li>
          <li>Your API tokens, and your sign-ins on every device.</li>
          <li>
            Any linked sign-in, such as GitHub, your password and your settings.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Files other people keep in your folders move to the top level of their
          own. Signing in again afterwards starts a new, empty account.
        </p>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" className="self-start">
              Delete account…
            </Button>
          </DialogTrigger>
          <DialogContent size="sm">
            <ConfirmDeletion account={account} />
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
