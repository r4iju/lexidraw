"use client";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { DotsHorizontalIcon, Link1Icon } from "@radix-ui/react-icons";
import { CodeNode as OriginalCodeNode } from "@lexical/code";
import { CODE_LANGUAGE_OPTIONS } from "./code-language";

function SelectLanguage() {
  const handleSelect = (language: string) => {
    console.warn("TODO handle language selection: ", language);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          <DotsHorizontalIcon className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          {CODE_LANGUAGE_OPTIONS.map(([language, friendlyName]) => (
            <DropdownMenuItem
              key={language}
              onSelect={() => handleSelect(language)}
              className="justify-between"
            >
              {friendlyName}
              <Link1Icon />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export class CodeNode extends OriginalCodeNode {
  toolbarComponent = SelectLanguage;
}
