"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createEntity } from "./create-entity";
import CreateUrlModal from "./create-url-modal";
import { NewMenu } from "./new-menu";

type Props = {
  parentId: string | null;
  compact?: boolean;
};

export function NewEntity({ parentId, compact }: Props) {
  const [isCreateUrlOpen, setIsCreateUrlOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <NewMenu
        compact={compact}
        pending={pending}
        onCreate={(kind) => {
          if (kind === "url") {
            setIsCreateUrlOpen(true);
            return;
          }
          startTransition(async () => {
            try {
              await createEntity(kind, parentId);
            } catch (error) {
              // The redirect that opens the new file arrives as a throw.
              if (isRedirect(error)) throw error;
              toast.error("Couldn’t create it. Try again.");
            }
          });
        }}
      />
      <CreateUrlModal
        parentId={parentId}
        open={isCreateUrlOpen}
        onOpenChange={setIsCreateUrlOpen}
      />
    </>
  );
}

function isRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
