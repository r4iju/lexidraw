import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { cn } from "~/lib/utils";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { useSettings } from "../../context/settings-context";

export function LlmModelSelector({ className }: { className?: string }) {
  const { settings, setOption } = useSettings();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("flex gap-2 h-12 md:h-10", className)}
        >
          AI
          <ChevronDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[280px] p-2">
        <DropdownMenuItem
          className="flex items-center justify-between mb-1 pr-2"
          onSelect={(e) => e.preventDefault()}
        >
          <Label htmlFor="enable-autocomplete" className="font-normal cursor-pointer">
            Enable Autocomplete
          </Label>
          <Switch
            id="enable-autocomplete"
            checked={settings.autocomplete}
            onCheckedChange={(checked: boolean | string) => {
              const isEnabled = checked === true;
              setOption("autocomplete", isEnabled);
            }}
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
