import type { MouseEvent } from "react";
import { SettingName } from "../../context/app-settings";
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

export function SettingsDropdown({ className }: { className?: string }) {
  const { settings, setOption } = useSettings();

  const camelToTitle = (camelCase: string): string => {
    return camelCase
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase());
  };

  const handleToggleSetting = (settingName: SettingName, e?: MouseEvent) => {
    e?.preventDefault();
    setOption(settingName, !settings[settingName]);
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
        {Object.keys(settings).map((key) => {
          const settingKey = key as SettingName;
          return (
            <DropdownMenuItem
              key={settingKey}
              onClick={(e) => handleToggleSetting(settingKey, e)}
              className={cn("flex justify-between items-center", {
                "font-semibold": settings[settingKey],
              })}
            >
              <span>{camelToTitle(settingKey)}</span>
              <Switch
                className="ml-2 cursor-auto"
                checked={settings[settingKey]}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
