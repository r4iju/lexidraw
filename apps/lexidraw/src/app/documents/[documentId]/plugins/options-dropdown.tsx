"use client";

import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { Switch } from "~/components/ui/switch";
import { toast } from "sonner";
import { useState } from "react";
import RenameEntityModal from "~/app/dashboard/_actions/rename-modal";
import DeleteEntityModal from "~/app/dashboard/_actions/delete-entity";
import type { RouterOutputs } from "~/trpc/shared";
import { AccessLevel } from "@packages/types";
import {
  GuardedLink,
  useUnsavedChanges,
} from "../../../../hooks/use-unsaved-changes";
import { useAutoSave } from "../../../../hooks/use-auto-save";

type Props = {
  className?: string;
  onSaveDocument: (onSuccessCallback?: () => void) => void;
  isSavingDocument: boolean;
  entity: Pick<
    RouterOutputs["entities"]["load"],
    "id" | "title" | "accessLevel"
  >;
};

export default function OptionsDropdown({
  className,
  onSaveDocument,
  isSavingDocument,
  entity,
}: Props) {
  const { markPristine } = useUnsavedChanges();
  const { enabled: autoSaveEnabled, setEnabled: setAutoSaveEnabled } =
    useAutoSave();
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const canEdit = entity.accessLevel === AccessLevel.EDIT;

  const handleDropdownSave = () => {
    if (isSavingDocument) return;

    onSaveDocument(() => {
      markPristine();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={className} variant="outline" size="icon">
          <HamburgerMenuIcon />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup title="App">
          <DropdownMenuItem asChild>
            <GuardedLink href="/dashboard">Go to dashboard</GuardedLink>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup title="Document">
          <DropdownMenuItem
            onClick={handleDropdownSave}
            disabled={isSavingDocument}
          >
            Save
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className="flex items-center justify-between gap-2"
          >
            <span>Auto-save</span>
            <Switch
              checked={autoSaveEnabled}
              onCheckedChange={setAutoSaveEnabled}
              onClick={(e) => e.stopPropagation()}
            />
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuItem onClick={() => setIsRenameOpen(true)}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsDeleteOpen(true)}>
                Delete
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onClick={() => toast.error("Not implemented yet!")}>
            Import from file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toast.error("Not implemented yet!")}>
            Export to file
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {canEdit && (
        <RenameEntityModal
          entity={entity}
          isOpen={isRenameOpen}
          onOpenChange={setIsRenameOpen}
        />
      )}
      {canEdit && (
        <DeleteEntityModal
          entity={{ id: entity.id, entityType: "document" }}
          isOpen={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
        />
      )}
    </DropdownMenu>
  );
}
