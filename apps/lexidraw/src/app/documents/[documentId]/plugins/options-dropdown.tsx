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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { Switch } from "~/components/ui/switch";
import { toast } from "sonner";
import { useState, useCallback } from "react";
import { FileDown, Loader2 } from "lucide-react";
import RenameEntityModal from "~/app/dashboard/_actions/rename-modal";
import DeleteEntityModal from "~/app/dashboard/_actions/delete-entity";
import TagEntityModal from "~/app/dashboard/_actions/tag-modal";
import type { RouterOutputs } from "~/trpc/shared";
import { AccessLevel } from "@packages/types";
import {
  GuardedLink,
  useUnsavedChanges,
} from "../../../../hooks/use-unsaved-changes";
import { useAutoSave } from "../../../../hooks/use-auto-save";
import { revalidate } from "../actions";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

type Props = {
  className?: string;
  onSaveDocument: (onSuccessCallback?: () => void) => void;
  isSavingDocument: boolean;
  onExportMarkdown?: () => void;
  entity: Pick<
    RouterOutputs["entities"]["load"],
    "id" | "title" | "accessLevel"
  >;
};

export default function OptionsDropdown({
  className,
  onSaveDocument,
  isSavingDocument,
  onExportMarkdown,
  entity,
}: Props) {
  const router = useRouter();
  const { markPristine } = useUnsavedChanges();
  const { enabled: autoSaveEnabled, setEnabled: setAutoSaveEnabled } =
    useAutoSave();
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isTagOpen, setIsTagOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const canEdit = entity.accessLevel === AccessLevel.EDIT;

  const exportPdf = api.documents.exportPdf.useMutation();

  const handleExportPdf = useCallback(async () => {
    setIsExportingPdf(true);
    const toastId = `pdf-export-${entity.id}-${Date.now()}`;
    try {
      toast.loading("Generating PDF...", { id: toastId });
      const result = await exportPdf.mutateAsync({
        documentId: entity.id,
      });

      const sanitizedTitle = entity.title
        ? entity.title
            .replace(/[^a-z0-9_\-.\s]/gi, "_")
            .replace(/\s+/g, "-")
            .toLowerCase()
            .substring(0, 60)
            .replace(/^-+|-+$/g, "")
        : "document";
      const filename = `${sanitizedTitle || "document"}.pdf`;

      toast.loading("Downloading PDF...", { id: toastId });
      const response = await fetch(result.pdfUrl, {
        method: "GET",
        headers: {
          Accept: "application/pdf",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Verify content-type
      const contentType = response.headers.get("content-type");
      if (contentType && !contentType.includes("application/pdf")) {
        throw new Error(`Invalid content type: ${contentType}`);
      }

      const blob = await response.blob();

      // Verify blob is actually PDF by checking first bytes
      const arrayBuffer = await blob.slice(0, 4).arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const pdfMagic = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
      const isValidPdf =
        bytes.length >= 4 &&
        bytes[0] === pdfMagic[0] &&
        bytes[1] === pdfMagic[1] &&
        bytes[2] === pdfMagic[2] &&
        bytes[3] === pdfMagic[3];

      if (!isValidPdf) {
        throw new Error("Response is not a valid PDF");
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);

      toast.success("PDF exported successfully", { id: toastId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error generating PDF";
      toast.error(msg, { id: toastId });
    } finally {
      setIsExportingPdf(false);
    }
  }, [entity.id, entity.title, exportPdf]);

  const handleDropdownSave = () => {
    if (isSavingDocument) return;

    onSaveDocument(() => {
      markPristine();
    });
  };

  const handleTagSuccess = async () => {
    await revalidate(entity.id);
    router.refresh();
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
              size="sm"
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
              <DropdownMenuItem onClick={() => setIsTagOpen(true)}>
                Edit tags
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsDeleteOpen(true)}>
                Delete
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onClick={() => toast.error("Not implemented yet!")}>
            Import from file
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Export to file</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                onClick={onExportMarkdown}
                disabled={!onExportMarkdown}
              >
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportPdf}
                disabled={isExportingPdf}
                className="flex items-center gap-2"
              >
                {isExportingPdf ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating PDF...
                  </>
                ) : (
                  <>
                    <FileDown className="h-4 w-4" />
                    PDF (.pdf)
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
          entity={{
            id: entity.id,
            entityType: "document",
            title: entity.title,
          }}
          isOpen={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
        />
      )}
      {canEdit && (
        <TagEntityModal
          entity={{ id: entity.id }}
          isOpen={isTagOpen}
          onOpenChange={setIsTagOpen}
          onSuccess={handleTagSuccess}
        />
      )}
    </DropdownMenu>
  );
}
