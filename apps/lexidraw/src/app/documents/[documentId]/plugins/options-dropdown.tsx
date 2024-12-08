"use client";

import { MutableRefObject } from "react";
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
import Link from "next/link";
// import { exportLexicalAsSvg } from "./export-svg";
import { exportDomTracedSvg } from "./export-rasterized-dom";
import { Theme } from "@packages/types";
import { useToast } from "~/components/ui/use-toast";
import { useTheme } from "next-themes";
import { useIsDarkTheme } from "~/components/theme/theme-provider";

type Props = {
  className?: string;
  documentId: string;
  state: MutableRefObject<EditorState | undefined>;
};

async function uploadToS3({
  uploadUrl,
  file: blob,
}: {
  uploadUrl: string;
  file: Blob;
}) {
  try {
    await fetch(uploadUrl, {
      method: "PUT",
      body: blob, // File object from input
      headers: {
        "Content-Type": blob.type,
      },
    });
  } catch (error) {
    console.error("Error uploading to S3", error);
  }
}

export default function OptionsDropdown({
  className,
  state,
  documentId,
}: Props) {
  const { setTheme } = useTheme();
  const isDarkTheme = useIsDarkTheme();
  const { toast } = useToast();
  const { mutate: save } = api.entities.save.useMutation();
  const { mutate: generateUploadUrls } =
    api.snapshot.generateUploadUrls.useMutation();

  const exportDocumentAsSvg = async () => {
    generateUploadUrls(
      {
        entityId: documentId,
        contentType: "image/svg+xml",
      },
      {
        onSuccess: async (uploadParams) => {
          const nextTheme = isDarkTheme ? Theme.DARK : Theme.LIGHT;
          console.log("uploadParams", uploadParams);
          const promises = [];
          for (const uploadParam of uploadParams) {
            // setTheme(uploadParam.theme);
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            // const svgString = await exportLexicalAsSvg();
            const svgString = await exportDomTracedSvg({
              setTheme: () => {setTheme(uploadParam.theme)},
              restoreTheme: () => {setTheme(nextTheme)},
            });
            const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
            promises.push(
              uploadToS3({
                uploadUrl: uploadParam.uploadUrl,
                file: svgBlob,
              }),
            );
          }
          // setTheme(nextTheme);
          await Promise.all(promises);
          toast({
            title: "Exported as SVG!",
          });
        },
        onError: (error) => {
          console.error("Error generating upload URL", error);
        },
      },
    );
  };

  const handleSave = () => {
    if (!state.current) {
      console.error("No state to save");
      return;
    }
    console.log(JSON.stringify(state.current));
    save(
      {
        id: documentId,
        elements: JSON.stringify(state.current),
        entityType: "document",
      },
      {
        onSuccess: async () => {
          await exportDocumentAsSvg();
          toast({
            title: "Saved!",
          });
        },
        onError: (error) => {
          toast({
            title: "Error saving",
            description: error.message,
            variant: "destructive",
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
            <Link href="/dashboard">Go to dashboard</Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup title="Document">
          <DropdownMenuItem onClick={handleSave}>Save</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              toast({
                title: "Not implemented yet!",
                variant: "destructive",
              })
            }
          >
            Import from file
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              toast({
                title: "Not implemented yet!",
                variant: "destructive",
              })
            }
          >
            Export to file
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
