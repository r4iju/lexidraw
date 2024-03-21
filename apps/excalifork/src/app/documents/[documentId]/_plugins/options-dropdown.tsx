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

type Props = {
  documentId: string;
  state: MutableRefObject<EditorState | undefined>;
};

export default function OptionsDropdown({ state, documentId }: Props) {
  const { mutate: save } = api.entities.save.useMutation();
  const handleSave = () => {
    if (!state.current) {
      console.error("No state to save");
      return;
    }
    console.log(JSON.stringify(state.current!));
    save({
      id: documentId,
      elements: JSON.stringify(state.current!),
      entityType: "document",
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <HamburgerMenuIcon className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup title="App">
          <DropdownMenuItem asChild>
            <Link href="/dashboard">
              Go to dashboard
            </Link>
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
