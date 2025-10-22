import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { useExportWebp } from "../plugins/export-webp";
import type { RouterOutputs } from "~/trpc/shared";
import { put } from "@vercel/blob/client";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { type RefObject, useState } from "react";
import type { EditorState } from "lexical";
import { useDocumentSettings } from "./document-settings-context";

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
  const { mutateAsync: generateThumbnailsViaWorker } =
    api.entities.generateThumbnailsViaWorker.useMutation();
  const { exportWebp } = useExportWebp();
  const [isUploading, setIsUploading] = useState(false);
  const { defaultFontFamily } = useDocumentSettings();

  const exportDocumentAsImage = async (): Promise<void> => {
    setIsUploading(true);
    return await new Promise<void>((resolve, reject) => {
      generateTokens(
        {
          entityId: entity.id,
          contentType: "image/webp",
        },
        {
          onError: (e) => {
            setIsUploading(false);
            reject(e);
          },
          onSuccess: async (tokens) => {
            try {
              const nextTheme = isDarkTheme ? Theme.DARK : Theme.LIGHT;

              // Run sequentially to avoid multiple heavy html2canvas clones at once
              const uploaded: { theme: string; url: string }[] = [];
              for (const { token, pathname, theme } of tokens) {
                // Switch theme, wait for next two frames to ensure styles/layout settle
                setTheme(theme);
                await new Promise((r) =>
                  requestAnimationFrame(() => requestAnimationFrame(r)),
                );
                const webpBlob = await exportWebp(
                  {
                    setTheme: () => {},
                    restoreTheme: () => setTheme(nextTheme),
                  },
                  {
                    theme,
                    isolateCloneDocument: true,
                    pruneDepth: null,
                    keepFirstChildren: null,
                    charLimitPerTextNode: 400,
                    skipHeavyEmbeds: true,
                    replaceImages: "none",
                    stripComplexStyles: false,
                    foreignObjectRendering: true,
                    maxTraverseNodes: 6000,
                    reduceFonts: false,
                    scale: 1,
                  },
                );

                const { url } = await put(pathname, webpBlob, {
                  access: "public",
                  multipart: true,
                  contentType: webpBlob.type,
                  token,
                });

                uploaded.push({ theme, url });
              }

              const light = uploaded.find((u) => u.theme === "light")?.url;
              const dark = uploaded.find((u) => u.theme === "dark")?.url;

              await new Promise<void>((resolveUpdate, rejectUpdate) => {
                updateEntity(
                  {
                    id: entity.id,
                    screenShotLight: light,
                    screenShotDark: dark,
                  },
                  {
                    onSuccess: () => resolveUpdate(),
                    onError: (e) => rejectUpdate(e),
                  },
                );
              });

              resolve();
            } catch (e) {
              console.error(
                "Error exporting thumbnails in options-dropdown.tsx",
                e,
              );
              reject(e);
            } finally {
              setIsUploading(false);
            }
          },
        },
      );
    });
  };

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
          try {
            toast.loading("Uploading thumbnails…", {
              id: TOAST_ID,
              duration: Infinity,
            });
            try {
              await generateThumbnailsViaWorker({ id: entity.id });
            } catch {
              await exportDocumentAsImage();
            }
            toast.success("Saved", { id: TOAST_ID });
            router.push("/dashboard");
          } catch (e) {
            toast.error("Error saving", {
              id: TOAST_ID,
              description: (e as Error).message,
            });
          }
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
          try {
            toast.loading("Uploading thumbnails…", {
              id: TOAST_ID,
              duration: Infinity,
            });
            try {
              await generateThumbnailsViaWorker({ id: entity.id });
            } catch {
              await exportDocumentAsImage();
            }
            toast.success("Saved", { id: TOAST_ID });
            onSaveSuccessCallback?.();
          } catch (e) {
            toast.error("Error saving", {
              id: TOAST_ID,
              description: (e as Error).message,
            });
          }
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

  return { handleSaveAndLeave, handleSave, isUploading };
}
