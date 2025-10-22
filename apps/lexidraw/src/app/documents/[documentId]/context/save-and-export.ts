import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import type { RefObject } from "react";
import type { EditorState } from "lexical";
import { useDocumentSettings } from "./document-settings-context";

export function useSaveAndExportDocument({
  entity,
  editorStateRef,
}: {
  entity: RouterOutputs["entities"]["load"];
  editorStateRef: RefObject<EditorState | undefined>;
}) {
  const router = useRouter();
  const { mutate: save } = api.entities.save.useMutation();
  const { defaultFontFamily } = useDocumentSettings();

  const handleSaveAndLeave = () => {
    if (!editorStateRef.current) {
      toast.error("No state to save");
      return;
    }

    const TOAST_ID = `save-${entity.id}`;
    toast.loading("Saving…", { id: TOAST_ID, duration: Infinity });
    save(
      {
        id: entity.id,
        elements: JSON.stringify(editorStateRef.current),
        appState: JSON.stringify({ defaultFontFamily }),
        entityType: "document",
      },
      {
        onSuccess: async () => {
          toast.success("Saved", { id: TOAST_ID });
          router.push("/dashboard");
        },
        onError: (error: TRPCClientErrorLike<AppRouter>) => {
          toast.error("Error saving", {
            id: TOAST_ID,
            description: error.message,
          });
        },
      },
    );
  };

  const handleSave = (onSaveSuccessCallback?: () => void) => {
    if (!editorStateRef.current) {
      toast.error("No state to save");
      return;
    }
    const TOAST_ID = `save-${entity.id}`;
    toast.loading("Saving…", { id: TOAST_ID, duration: Infinity });
    save(
      {
        id: entity.id,
        elements: JSON.stringify(editorStateRef.current),
        appState: JSON.stringify({ defaultFontFamily }),
        entityType: "document",
      },
      {
        onSuccess: async () => {
          toast.success("Saved", { id: TOAST_ID });
          onSaveSuccessCallback?.();
        },
        onError: (error) => {
          toast.error("Error saving", {
            id: TOAST_ID,
            description: error.message,
          });
        },
      },
    );
  };

  return { handleSaveAndLeave, handleSave };
}
