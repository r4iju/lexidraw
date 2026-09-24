import { documentSettings } from "~/lib/document-fonts";
import { toast } from "sonner";
import type { OpenEntity } from "~/hooks/use-open-entity-sync";
import type { RouterOutputs } from "~/trpc/shared";
import type { RefObject } from "react";
import { useState, useCallback } from "react";
import type { EditorState } from "lexical";
import { useDocumentSettings } from "./document-settings-context";
import { useMarkdownTools } from "../utils/markdown";

export function useSaveAndExportDocument({
  entity,
  editorStateRef,
  openDocument,
}: {
  entity: RouterOutputs["entities"]["load"];
  editorStateRef: RefObject<EditorState | undefined>;
  openDocument: OpenEntity;
}) {
  const { defaultFontFamily, lang } = useDocumentSettings();
  const [isSaving, setIsSaving] = useState(false);
  const { convertEditorStateToMarkdown } = useMarkdownTools();

  /** Saves what the editor holds; see `OpenEntitySync.save`. */
  const save = (
    editorState: EditorState,
    callbacks: {
      onSuccess: () => void;
      onDropped?: () => void;
      onError: (error: Error) => void;
    },
  ) => {
    openDocument.sync
      .save({
        elements: JSON.stringify(editorState),
        appState: JSON.stringify({
          ...documentSettings(entity.appState),
          defaultFontFamily,
          lang,
        }),
      })
      .then(
        (outcome) =>
          outcome === "saved" ? callbacks.onSuccess() : callbacks.onDropped?.(),
        callbacks.onError,
      );
  };

  /** Saves on the way out of the editor; answers whether it landed. */
  const saveBeforeLeaving = () =>
    new Promise<boolean>((resolve) => {
      if (!editorStateRef.current) {
        toast.error("No state to save");
        resolve(false);
        return;
      }
      const TOAST_ID = `save-${entity.id}`;
      toast.loading("Saving…", { id: TOAST_ID, duration: Infinity });
      setIsSaving(true);
      save(editorStateRef.current, {
        onSuccess: () => {
          toast.success("Saved", { id: TOAST_ID });
          setIsSaving(false);
          resolve(true);
        },
        onDropped: () => {
          toast.dismiss(TOAST_ID);
          setIsSaving(false);
          resolve(false);
        },
        onError: (error) => {
          toast.error("Error saving", {
            id: TOAST_ID,
            description: error.message,
          });
          setIsSaving(false);
          resolve(false);
        },
      });
    });

  const handleSave = (onSaveSuccessCallback?: () => void) => {
    if (!editorStateRef.current) {
      toast.error("No state to save");
      return;
    }
    const TOAST_ID = `save-${entity.id}`;
    toast.loading("Saving…", { id: TOAST_ID, duration: Infinity });
    setIsSaving(true);
    save(editorStateRef.current, {
      onSuccess: () => {
        toast.success("Saved", { id: TOAST_ID });
        setIsSaving(false);
        onSaveSuccessCallback?.();
      },
      onDropped: () => {
        toast.dismiss(TOAST_ID);
        setIsSaving(false);
      },
      onError: (error) => {
        toast.error("Error saving", {
          id: TOAST_ID,
          description: error.message,
        });
        setIsSaving(false);
      },
    });
  };

  const handleSilentSave = (onSaveSuccessCallback?: () => void) => {
    if (!editorStateRef.current) {
      return;
    }
    save(editorStateRef.current, {
      onSuccess: () => {
        onSaveSuccessCallback?.();
      },
      onError: (error) => {
        console.error("Auto-save failed:", error);
      },
    });
  };

  const sanitizeFilename = useCallback((name: string): string => {
    return name
      .replace(/[^a-z0-9_\-.\s]/gi, "_")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .substring(0, 60)
      .replace(/^-+|-+$/g, "");
  }, []);

  const exportMarkdown = useCallback(() => {
    const currentState = editorStateRef.current;
    if (!currentState) {
      toast.error("No content to export");
      return;
    }

    try {
      const markdown = convertEditorStateToMarkdown(currentState);

      if (!markdown) {
        toast.error("Document is empty");
        return;
      }

      const sanitizedTitle = entity.title
        ? sanitizeFilename(entity.title)
        : "document";
      const filename = `${sanitizedTitle || "document"}.md`;

      const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Markdown exported successfully");
    } catch (error) {
      console.error("[exportMarkdown] export error:", error);
      toast.error("Failed to export markdown", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [
    convertEditorStateToMarkdown,
    entity.title,
    sanitizeFilename,
    editorStateRef,
  ]);

  return {
    saveBeforeLeaving,
    handleSave,
    handleSilentSave,
    exportMarkdown,
    isUploading: isSaving,
  };
}
