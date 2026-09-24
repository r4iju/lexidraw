"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useState } from "react";
import type { RouterOutputs } from "~/trpc/shared";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  FolderOpenIcon,
  ImageDownIcon,
  PencilIcon,
  RotateCcwIcon,
  SaveIcon,
  TagsIcon,
  Trash2Icon,
} from "lucide-react";
import { loadFromBlob, MainMenu } from "@excalidraw/excalidraw";
import RenameEntityModal from "~/app/dashboard/_actions/rename-modal";
import DeleteEntityModal from "~/app/dashboard/_actions/delete-entity";
import TagEntityModal from "~/app/dashboard/_actions/tag-modal";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { useAutoSave } from "~/hooks/use-auto-save";
import { saveShortcutLabel } from "~/hooks/use-save-shortcut";
import { revalidate } from "./actions";
import { downloadScene } from "./download-scene";
import { useRouter } from "next/navigation";

type Props = {
  drawing: RouterOutputs["entities"]["load"];
  excalidrawApi: ExcalidrawImperativeAPI | null;
  onSave: () => void;
};

type Replacing = "open" | "clear" | null;

// Excalidraw's own menu styles are unlayered, so a utility class loses to them.
const DESTRUCTIVE = { color: "var(--destructive)" };

export const DrawingBoardMenu = ({ drawing, excalidrawApi, onSave }: Props) => {
  const router = useRouter();
  const { enabled: autoSaveEnabled, setEnabled: setAutoSaveEnabled } =
    useAutoSave();
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isTagOpen, setIsTagOpen] = useState(false);
  const [replacing, setReplacing] = useState<Replacing>(null);

  const isEmpty = () =>
    !excalidrawApi?.getSceneElements().some((element) => !element.isDeleted);

  const openFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".excalidraw";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const scene = await loadFromBlob(file, null, null).catch(() => null);
      if (!scene) {
        toast.error("Couldn't open that file", {
          description: "Choose a file saved from Excalidraw.",
        });
        return;
      }
      excalidrawApi?.updateScene(scene);
    };
    input.click();
  };

  const clearCanvas = () => {
    excalidrawApi?.updateScene({ elements: [] });
  };

  const replace = (what: Exclude<Replacing, null>) => {
    const act = what === "open" ? openFile : clearCanvas;
    if (isEmpty()) act();
    else setReplacing(what);
  };

  const downloadFile = () => {
    if (excalidrawApi) downloadScene(excalidrawApi, drawing.title);
  };

  // The dialogs sit outside the menu, which unmounts as an item closes it.
  return (
    <>
      <MainMenu>
        <MainMenu.Item
          icon={<ArrowLeftIcon size={16} />}
          onSelect={() => router.push("/dashboard")}
        >
          Back to Home
        </MainMenu.Item>
        <MainMenu.Separator />
        <MainMenu.Item
          icon={<SaveIcon size={16} />}
          shortcut={saveShortcutLabel()}
          onSelect={onSave}
        >
          Save
        </MainMenu.Item>
        <MainMenu.Item
          role="menuitemcheckbox"
          aria-checked={autoSaveEnabled}
          icon={autoSaveEnabled ? <CheckIcon size={16} /> : <span />}
          onSelect={(event) => {
            // The check flips where the reader is looking.
            event.preventDefault();
            setAutoSaveEnabled(!autoSaveEnabled);
          }}
        >
          Auto-save
        </MainMenu.Item>
        <MainMenu.Item
          icon={<FolderOpenIcon size={16} />}
          onSelect={() => replace("open")}
        >
          Open .excalidraw file…
        </MainMenu.Item>
        <MainMenu.Item
          icon={<DownloadIcon size={16} />}
          onSelect={downloadFile}
        >
          Download .excalidraw file
        </MainMenu.Item>
        <MainMenu.Item
          icon={<ImageDownIcon size={16} />}
          onSelect={() =>
            excalidrawApi?.updateScene({
              appState: { openDialog: { name: "imageExport" } },
            })
          }
        >
          Export image…
        </MainMenu.Item>
        <MainMenu.Separator />
        <MainMenu.Item
          icon={<PencilIcon size={16} />}
          onSelect={() => setIsRenameOpen(true)}
        >
          Rename…
        </MainMenu.Item>
        <MainMenu.Item
          icon={<TagsIcon size={16} />}
          onSelect={() => setIsTagOpen(true)}
        >
          Tags…
        </MainMenu.Item>
        <MainMenu.Separator />
        <MainMenu.Item
          icon={<RotateCcwIcon size={16} />}
          onSelect={() => replace("clear")}
        >
          Clear canvas…
        </MainMenu.Item>
        <MainMenu.Item
          icon={<Trash2Icon size={16} />}
          style={DESTRUCTIVE}
          onSelect={() => setIsDeleteOpen(true)}
        >
          Delete…
        </MainMenu.Item>
      </MainMenu>
      <ConfirmDialog
        open={replacing !== null}
        onOpenChange={(open) => {
          if (!open) setReplacing(null);
        }}
        title={replacing === "open" ? "Open a file here?" : "Clear canvas?"}
        description={
          replacing === "open"
            ? "The file you open replaces everything on this canvas."
            : "Everything on this canvas will be removed."
        }
        confirmLabel={replacing === "open" ? "Open file…" : "Clear canvas"}
        onConfirm={() => {
          if (replacing === "open") openFile();
          else clearCanvas();
        }}
      />
      <RenameEntityModal
        entity={{ id: drawing.id, title: drawing.title }}
        isOpen={isRenameOpen}
        onOpenChange={setIsRenameOpen}
      />
      <DeleteEntityModal
        entity={{
          id: drawing.id,
          entityType: "drawing",
          title: drawing.title,
        }}
        isOpen={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
      />
      <TagEntityModal
        entity={{ id: drawing.id }}
        isOpen={isTagOpen}
        onOpenChange={setIsTagOpen}
        onSuccess={async () => {
          await revalidate(drawing.id);
          router.refresh();
        }}
      />
    </>
  );
};
