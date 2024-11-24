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
import { exportLexicalAsSvg } from "./export-svg";
import { Theme } from "@packages/types";
import { useToast } from "~/components/ui/use-toast";

type Props = {
  className?: string;
  documentId: string;
  state: MutableRefObject<EditorState | undefined>;
};

export default function OptionsDropdown({
  className,
  state,
  documentId,
}: Props) {
  const { toast } = useToast();
  const { mutate: save } = api.entities.save.useMutation();
  const { mutate: saveSvg } = api.snapshot.create.useMutation();

  const exportDocumentAsSvg = async () => {
    const svgString = exportLexicalAsSvg();
    [Theme.DARK, Theme.LIGHT].map(async (theme) => {
      saveSvg({
        entityId: documentId,
        svg: svgString,
        theme: theme,
      });
    });
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
