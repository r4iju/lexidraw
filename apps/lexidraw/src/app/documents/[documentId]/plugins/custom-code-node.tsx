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
import { CODE_LANGUAGE_MAP, CodeNode as OriginalCodeNode } from "@lexical/code";

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
          {Object.keys(CODE_LANGUAGE_MAP).map((language) => (
            <DropdownMenuItem
              key={language}
              onSelect={() => handleSelect(language)}
              className="justify-between"
            >
              {language}
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