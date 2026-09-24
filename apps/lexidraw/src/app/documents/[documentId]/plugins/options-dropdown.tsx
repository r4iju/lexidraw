"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useState, useCallback, useRef } from "react";
import { FileDown, Loader2 } from "lucide-react";
import RenameEntityModal from "~/app/dashboard/_actions/rename-modal";
import DeleteEntityModal from "~/app/dashboard/_actions/delete-entity";
import TagEntityModal from "~/app/dashboard/_actions/tag-modal";
import ImportMarkdownModal from "./ImportMarkdownModal";
import type { RouterOutputs } from "~/trpc/shared";
import { AccessLevel } from "@packages/types";
import type { MarkdownInsertMode } from "../utils/markdown";
import { useAutoSave } from "~/hooks/use-auto-save";
import { saveShortcutLabel } from "~/hooks/use-save-shortcut";
import { useSidebarManager } from "~/context/sidebar-manager-context";
import { revalidate } from "../actions";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { useSignedIn } from "../context/signed-in-context";

type PdfPaper = "A4" | "Letter";
type PdfOrientation = "portrait" | "landscape";

const PDF_PAGES: {
  label: string;
  paper: PdfPaper;
  orientation: PdfOrientation;
}[] = [
  { label: "A4 portrait", paper: "A4", orientation: "portrait" },
  { label: "A4 landscape", paper: "A4", orientation: "landscape" },
  { label: "Letter portrait", paper: "Letter", orientation: "portrait" },
  { label: "Letter landscape", paper: "Letter", orientation: "landscape" },
];

type Props = {
  className?: string;
  onSave: () => void;
  /** Opens sharing; absent for someone who may not share. */
  onShare?: () => void;
  onExportMarkdown?: () => void;
  onImportMarkdown?: (markdown: string, mode: MarkdownInsertMode) => void;
  entity: Pick<
    RouterOutputs["entities"]["load"],
    "id" | "title" | "accessLevel"
  >;
};

export default function OptionsDropdown({
  className,
  onSave,
  onShare,
  onExportMarkdown,
  onImportMarkdown,
  entity,
}: Props) {
  const router = useRouter();
  const { activeSidebar, toggleSidebar } = useSidebarManager();
  const canEdit = entity.accessLevel === AccessLevel.EDIT;
  const { enabled: autoSaveEnabled, setEnabled: setAutoSaveEnabled } =
    useAutoSave({ enabled: canEdit });
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isTagOpen, setIsTagOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [modalMarkdown, setModalMarkdown] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const signedIn = useSignedIn();
  const utils = api.useUtils();

  const handleExportPdf = useCallback(
    async (paper: PdfPaper, orientation: PdfOrientation) => {
      setIsExportingPdf(true);
      const toastId = `pdf-export-${entity.id}-${Date.now()}`;
      try {
        toast.loading("Generating PDF...", { id: toastId });
        const rendered = await utils.documents.render.fetch(
          { id: entity.id, format: "pdf", paper, orientation },
          // Each export prints the document as it is now.
          { staleTime: 0, gcTime: 0 },
        );

        const sanitizedTitle = entity.title
          ? entity.title
              .replace(/[^a-z0-9_\-.\s]/gi, "_")
              .replace(/\s+/g, "-")
              .toLowerCase()
              .substring(0, 60)
              .replace(/^-+|-+$/g, "")
          : "document";
        const filename = `${sanitizedTitle || "document"}.pdf`;

        const bytes = Uint8Array.from(atob(rendered.data), (c) =>
          c.charCodeAt(0),
        );
        const blob = new Blob([bytes], {
          type: rendered.contentType,
        });

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
    },
    [entity.id, entity.title, utils],
  );

  const handleTagSuccess = async () => {
    await revalidate(entity.id);
    router.refresh();
  };

  const handleMarkdownImportClick = useCallback(() => {
    if (!onImportMarkdown || !canEdit) {
      toast.error("Import not available");
      return;
    }
    // Trigger file input immediately
    fileInputRef.current?.click();
  }, [onImportMarkdown, canEdit]);

  const handleModalConfirm = useCallback(
    (mode: MarkdownInsertMode) => {
      if (!onImportMarkdown || !modalMarkdown) {
        toast.error("Import not available");
        return;
      }
      try {
        onImportMarkdown(modalMarkdown, mode);
        toast.success("Markdown imported successfully");
        setModalMarkdown("");
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Failed to import markdown";
        toast.error(msg);
      }
    },
    [onImportMarkdown, modalMarkdown],
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      if (!onImportMarkdown) {
        toast.error("Import not available");
        event.target.value = "";
        return;
      }

      // Validate file type
      const validTypes = [
        "text/markdown",
        "text/plain",
        "application/x-markdown",
      ];
      const validExtensions = [".md", ".markdown", ".txt"];
      const fileName = file.name.toLowerCase();
      const hasValidExtension = validExtensions.some((ext) =>
        fileName.endsWith(ext),
      );
      const hasValidType = validTypes.includes(file.type) || file.type === "";

      if (!hasValidExtension && !hasValidType) {
        toast.error("Please select a markdown file (.md, .markdown)");
        event.target.value = "";
        return;
      }

      const toastId = `import-${entity.id}-${Date.now()}`;
      toast.loading("Reading file...", { id: toastId });

      try {
        const text = await file.text();

        if (!text.trim()) {
          toast.error("File is empty", { id: toastId });
          event.target.value = "";
          return;
        }

        // Set markdown and open modal
        setModalMarkdown(text);
        setIsImportModalOpen(true);
        toast.dismiss(toastId);
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Failed to read file";
        toast.error(msg, { id: toastId });
      } finally {
        event.target.value = "";
      }
    },
    [onImportMarkdown, entity.id],
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="hidden"
        onChange={handleFileChange}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className={className}
            variant="ghost"
            size="icon"
            aria-label="Document actions"
            title="Document actions"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuGroup>
            {canEdit && (
              <DropdownMenuItem onClick={onSave}>
                Save
                <DropdownMenuShortcut>
                  {saveShortcutLabel()}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {onShare && (
              <DropdownMenuItem onClick={onShare}>Share…</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => window.print()}>
              Print…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={onExportMarkdown}
                  disabled={!onExportMarkdown}
                >
                  Markdown (.md)
                </DropdownMenuItem>
                {signedIn && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      disabled={isExportingPdf}
                      className="flex items-center gap-2"
                    >
                      {isExportingPdf ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileDown className="h-4 w-4" />
                      )}
                      PDF (.pdf)
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {PDF_PAGES.map(({ label, paper, orientation }) => (
                        <DropdownMenuItem
                          key={label}
                          disabled={isExportingPdf}
                          onClick={() => handleExportPdf(paper, orientation)}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {canEdit && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Import</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onClick={handleMarkdownImportClick}
                    disabled={!onImportMarkdown}
                  >
                    Markdown (.md)
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </DropdownMenuGroup>
          {/* On a phone the app bar has no room for the reading tools. */}
          <DropdownMenuGroup className="sm:hidden">
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={activeSidebar === "comments"}
              onCheckedChange={() => toggleSidebar("comments")}
            >
              Comments
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={activeSidebar === "toc"}
              onCheckedChange={() => toggleSidebar("toc")}
            >
              Table of contents
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setIsRenameOpen(true)}>
                  Rename…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsTagOpen(true)}>
                  Tags…
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={autoSaveEnabled}
                onCheckedChange={setAutoSaveEnabled}
                onSelect={(event) => event.preventDefault()}
              >
                Auto-save
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setIsDeleteOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                Delete…
              </DropdownMenuItem>
            </>
          )}
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
        <ImportMarkdownModal
          isOpen={isImportModalOpen}
          onOpenChange={(open) => {
            setIsImportModalOpen(open);
            if (!open) {
              setModalMarkdown("");
            }
          }}
          markdown={modalMarkdown}
          onConfirm={handleModalConfirm}
          canEdit={canEdit}
        />
      </DropdownMenu>
    </>
  );
}
