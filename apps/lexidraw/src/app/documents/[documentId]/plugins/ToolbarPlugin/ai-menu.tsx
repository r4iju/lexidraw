import { Bug, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { useSidebarManager } from "~/context/sidebar-manager-context";
import { setDeveloperFlag } from "~/lib/developer-flag";
import { useSettings } from "../../context/settings-context";
import { ToolbarMenu } from "./toolbar";

export function AiItems() {
  const { settings, setOption } = useSettings();
  const { setActiveSidebar } = useSidebarManager();
  return (
    <>
      <DropdownMenuItem
        className="gap-2"
        onSelect={() => setActiveSidebar("llm")}
      >
        <Sparkles className="size-4" />
        Ask AI…
      </DropdownMenuItem>
      <DropdownMenuCheckboxItem
        checked={settings.autocomplete}
        onCheckedChange={(checked) => setOption("autocomplete", checked)}
      >
        Autocomplete
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild className="gap-2">
        <Link href="/settings#settings-ai">
          <Settings className="size-4" />
          AI settings…
        </Link>
      </DropdownMenuItem>
    </>
  );
}

export function AiMenu() {
  return (
    <ToolbarMenu label="AI" icon={Sparkles} trigger="AI">
      <AiItems />
    </ToolbarMenu>
  );
}

/** For working on the editor itself: shown only with the developer flag. */
export function DeveloperItems() {
  const { settings, setOption } = useSettings();
  const { activeSidebar, toggleSidebar } = useSidebarManager();
  return (
    <>
      <DropdownMenuCheckboxItem
        checked={activeSidebar === "tree"}
        onCheckedChange={() => toggleSidebar("tree")}
      >
        Document tree
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={settings.showNestedEditorTreeView}
        onCheckedChange={(checked) =>
          setOption("showNestedEditorTreeView", checked)
        }
      >
        Tree views in nested editors
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => setDeveloperFlag(false)}>
        Hide developer tools
      </DropdownMenuItem>
    </>
  );
}

export function DeveloperMenu() {
  return (
    <ToolbarMenu label="Developer tools" icon={Bug} align="end">
      <DeveloperItems />
    </ToolbarMenu>
  );
}
