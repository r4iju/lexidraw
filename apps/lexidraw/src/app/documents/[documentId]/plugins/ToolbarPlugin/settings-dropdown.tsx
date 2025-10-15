import type { SettingName } from "../../context/app-settings";
import { useSettings } from "../../context/settings-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Settings as SettingsIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useSidebarManager } from "~/context/sidebar-manager-context";

export function SettingsDropdown({ className }: { className?: string }) {
  const { settings, setOption } = useSettings();
  const { activeSidebar, toggleSidebar } = useSidebarManager();

  const camelToTitle = (camelCase: string): string => {
    return camelCase
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase());
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("flex gap-2 h-12 md:h-10", className)}
        >
          <SettingsIcon size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {Object.entries(settings).map(([key, value]) => {
          const name = key as SettingName;

          return (
            <DropdownMenuItem
              key={name}
              onSelect={(e) => {
                e.preventDefault();
                setOption(name, !value);
              }}
              className={cn("flex justify-between items-center", {
                "font-semibold": value,
              })}
            >
              <span>{camelToTitle(name)}</span>
              <Switch
                checked={value}
                onCheckedChange={(checked) => setOption(name, checked)}
              />
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            toggleSidebar("tree");
          }}
          className={cn("flex justify-between items-center", {
            "font-semibold": activeSidebar === "tree",
          })}
        >
          <span>Document Tree</span>
          <Switch
            checked={activeSidebar === "tree"}
            // toggled by onSelect above
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
