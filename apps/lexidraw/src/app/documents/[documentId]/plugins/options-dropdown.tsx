"use client";

import type { RefObject } from "react";
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
  const { mutate: generateUploadUrls } =
    api.snapshot.generateUploadUrls.useMutation();

  const { exportWebp } = useExportWebp();

  const uploadToS3 = async ({
    uploadUrl,
    file: blob,
  }: {
    uploadUrl: string;
    file: Blob;
  }) => {
    try {
      await fetch(uploadUrl, {
        method: "PUT",
        body: blob,
        headers: {
          "Content-Type": blob.type,
        },
      });
    } catch (error) {
      console.error("Error uploading to S3", error);
    }
  };

  const exportDocumentAsImage = async () => {
    generateUploadUrls(
      {
        entityId: documentId,
        contentType: "image/webp",
      },
      {
        onSuccess: async (uploadParams) => {
          const nextTheme = isDarkTheme ? Theme.DARK : Theme.LIGHT;
          console.log({ uploadParams });
          const promises = [];
          for (const uploadParam of uploadParams) {
            // setTheme(uploadParam.theme);
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            const webpBlob = await exportWebp({
              setTheme: () => {
                setTheme(uploadParam.theme);
              },
              restoreTheme: () => {
                setTheme(nextTheme);
              },
            });
            promises.push(
              uploadToS3({
                uploadUrl: uploadParam.signedUploadUrl,
                file: webpBlob,
              }),
            );
          }
          // setTheme(nextTheme);
          await Promise.all(promises);
          toast.success("Exported thumbnails!");
        },
        onError: (error) => {
          console.error("Error generating upload URL", error);
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
          <DropdownMenuItem onClick={handleSave}>Save</DropdownMenuItem>
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
