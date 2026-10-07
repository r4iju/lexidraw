import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import {
  CODE_LANGUAGE_OPTIONS,
  getCodeLanguageFriendlyName,
} from "../code-language";

const PLAIN_TEXT = "Plain text";

/** A compact button naming the block's language, opening a searchable list. */
export function LanguagePicker({
  language,
  onChange,
}: {
  language: string;
  onChange: (language: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // A language saved under a name Shiki does not list stays choosable.
  const unlisted: [string, string][] =
    language && !CODE_LANGUAGE_OPTIONS.some(([value]) => value === language)
      ? [[language, getCodeLanguageFriendlyName(language)]]
      : [];
  const options: [string, string][] = [
    ["", PLAIN_TEXT],
    ...unlisted,
    ...CODE_LANGUAGE_OPTIONS,
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Code language"
          aria-expanded={open}
          className="document-code-language"
        >
          {getCodeLanguageFriendlyName(language) || PLAIN_TEXT}
          <ChevronDownIcon aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Search languages…" />
          <CommandList>
            <CommandEmpty>No language matches.</CommandEmpty>
            <CommandGroup>
              {options.map(([value, label]) => (
                <CommandItem
                  key={value || "plain"}
                  value={value || "plaintext"}
                  keywords={[label]}
                  onSelect={() => {
                    onChange(value);
                    setOpen(false);
                  }}
                >
                  {label}
                  <CheckIcon
                    aria-hidden
                    className={cn(
                      "ml-auto size-4",
                      value === language ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
