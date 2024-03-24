"use client";

import { MutableRefObject } from "react";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { EditorState } from "lexical";
import { api } from "~/trpc/react";
import {
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { exportLexicalAsSvg } from "./export-svg";
import { Theme } from "@packages/types";

type Props = {
  documentId: string;
  state: MutableRefObject<EditorState | undefined>;
};

export default function OptionsDropdown({ state, documentId }: Props) {
  const { mutate: save } = api.entities.save.useMutation();
  const { mutate: saveSvg } = api.snapshot.create.useMutation();

  const exportDrawingAsSvg = async () => {
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
    console.log(JSON.stringify(state.current!));
    save(
      {
        id: documentId,
        elements: JSON.stringify(state.current!),
        entityType: "document",
      },
      {
        onSuccess: async () => {
          await exportDrawingAsSvg();
        },
      },
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
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
          <DropdownMenuItem onClick={() => console.log("...")}>
            Import from file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => console.log("...")}>
            Export to file
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
