"use client";

import { useState, type RefObject } from "react";
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
import { EditorState } from "lexical";
import { api } from "~/trpc/react";
import { Theme } from "@packages/types";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useExportWebp } from "./export-webp";
import { GuardedLink } from "../../../../hooks/use-unsaved-changes";
import { put } from "@vercel/blob/client";

type Props = {
  className?: string;
  documentId: string;
  state: RefObject<EditorState | undefined>;
};

export default function OptionsDropdown({
  className,
  state,
  documentId,
}: Props) {
  const { setTheme } = useTheme();
  const isDarkTheme = useIsDarkTheme();
  const { mutate: save } = api.entities.save.useMutation();
  const { mutate: generateTokens } =
    api.snapshot.generateClientUploadTokens.useMutation();
  const { mutate: updateEntity } = api.entities.update.useMutation();
  const [isUploading, setIsUploading] = useState(false);

  const { exportWebp } = useExportWebp();

  const exportDocumentAsImage = async () => {
    setIsUploading(true);

    generateTokens(
      {
        entityId: documentId,
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
                  id: documentId,
                  screenShotLight: light,
                  screenShotDark: dark,
                },
                { onSuccess: () => resolve(), onError: (e) => reject(e) },
              );
            });

            toast.success("Exported thumbnails!");
          } catch (e) {
            console.error("Error exporting thumbnails in options-dropdown.tsx", e);
            toast.error("Upload failed", { description: (e as Error).message });
          } finally {
            setIsUploading(false);
          }
        },
      },
    );
  };

  const handleSave = () => {
    if (!state.current) {
      toast.error("No state to save");
      return;
    }
    save(
      {
        id: documentId,
        elements: JSON.stringify(state.current),
        entityType: "document",
      },
      {
        onSuccess: async () => {
          toast.success("Saved!");
          // unless entity exists, can't update screenshot reference
          await exportDocumentAsImage();
        },
        onError: (error) => {
          toast.error("Error saving", {
            description: error.message,
          });
        },
      },
    );
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
          <DropdownMenuItem onClick={handleSave} disabled={isUploading}>
            Save
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toast.error("Not implemented yet!")}>
            Import from file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toast.error("Not implemented yet!")}>
            Export to file
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
