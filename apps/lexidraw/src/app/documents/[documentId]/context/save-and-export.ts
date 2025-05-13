import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { useExportWebp } from "../plugins/export-webp";
import { RouterOutputs } from "~/trpc/shared";
import { put } from "@vercel/blob/client";
import { TRPCClientErrorLike } from "@trpc/client";
import { AppRouter } from "~/server/api/root";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { RefObject, useState } from "react";
import { EditorState } from "lexical";

export function useSaveAndExportDocument({
  entity,
  editorStateRef,
}: {
  entity: RouterOutputs["entities"]["load"];
  editorStateRef: RefObject<EditorState | undefined>;
}) {
  const { setTheme } = useTheme();
  const isDarkTheme = useIsDarkTheme();
  const router = useRouter();
  const { mutate: save } = api.entities.save.useMutation();
  const { mutate: generateTokens } =
    api.snapshot.generateClientUploadTokens.useMutation();
  const { mutate: updateEntity } = api.entities.update.useMutation();
  const { exportWebp } = useExportWebp();
  const [isUploading, setIsUploading] = useState(false);

  const exportDocumentAsImage = async () => {
    setIsUploading(true);

    generateTokens(
      {
        entityId: entity.id,
        contentType: "image/webp",
      },
      {
        onError: (e) => {
          toast.error("Could not prepare upload", { description: e.message });
          setIsUploading(false);
        },
        onSuccess: async (tokens) => {
          try {
            const nextTheme = isDarkTheme ? Theme.DARK : Theme.LIGHT;

            const uploaded = await Promise.all(
              tokens.map(async ({ token, pathname, theme }) => {
                /* let exportWebp switch theme on the fly */
                const webpBlob = await exportWebp({
                  setTheme: () => setTheme(theme),
                  restoreTheme: () => setTheme(nextTheme),
                });

                const { url } = await put(pathname, webpBlob, {
                  access: "public",
                  multipart: true,
                  contentType: webpBlob.type,
                  token,
                });

                return { theme, url };
              }),
            );

            const light = uploaded.find((u) => u.theme === "light")?.url;
            const dark = uploaded.find((u) => u.theme === "dark")?.url;

            await new Promise<void>((resolve, reject) => {
              updateEntity(
                {
                  id: entity.id,
                  screenShotLight: light,
                  screenShotDark: dark,
                },
                { onSuccess: () => resolve(), onError: (e) => reject(e) },
              );
            });

            toast.success("Exported thumbnails!");
          } catch (e) {
            console.error(
              "Error exporting thumbnails in options-dropdown.tsx",
              e,
            );
            toast.error("Upload failed", { description: (e as Error).message });
          } finally {
            setIsUploading(false);
          }
        },
      },
    );
  };

  const handleSaveAndLeave = () => {
    if (!editorStateRef.current) {
      toast.error("No state to save");
      return;
    }
    save(
      {
        id: entity.id,
        elements: JSON.stringify(editorStateRef.current),
        entityType: "document",
      },
      {
        onSuccess: async () => {
          toast.success("Saved!");
          await exportDocumentAsImage();
          router.push("/dashboard");
        },
        onError: (error: TRPCClientErrorLike<AppRouter>) => {
          toast.error("Error saving", {
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
    save(
      {
        id: entity.id,
        elements: JSON.stringify(editorStateRef.current),
        entityType: "document",
      },
      {
        onSuccess: async () => {
          toast.success("Saved!");
          await exportDocumentAsImage();
          onSaveSuccessCallback?.();
        },
        onError: (error) => {
          toast.error("Error saving", {
            description: error.message,
          });
        },
      },
    );
  };

  return { handleSaveAndLeave, handleSave, isUploading };
}
