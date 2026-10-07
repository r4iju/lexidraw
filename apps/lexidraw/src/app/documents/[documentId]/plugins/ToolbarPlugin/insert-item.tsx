import type { LexicalEditor } from "lexical";
import { Plus } from "lucide-react";
import { Fragment } from "react";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { type ShowModal, useInsertEntries } from "../block-catalog";
import { type BlockEntry, searchEntries } from "../block-search";
import { ToolbarMenu } from "./toolbar";

export type { ShowModal } from "../block-catalog";

/** Everything that can be inserted, in labelled groups. */
export function InsertItems({
  editor,
  showModal,
  query = "",
}: {
  editor: LexicalEditor;
  showModal: ShowModal;
  /** Leaves out what doesn't match, as the slash menu does. */
  query?: string;
}) {
  const entries = useInsertEntries(editor, showModal);
  const groups = new Map<string, BlockEntry[]>();
  for (const entry of searchEntries(entries, query))
    groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  if (groups.size === 0)
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        Nothing to insert matches “{query.trim()}”.
      </p>
    );
  return [...groups].map(([label, entries], index) => (
    <Fragment key={label}>
      {index > 0 && <DropdownMenuSeparator />}
      <DropdownMenuGroup aria-label={label}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {entries.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            className="gap-2"
            onSelect={entry.run}
          >
            {entry.icon}
            {entry.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </Fragment>
  ));
}

export function InsertMenu({
  editor,
  disabled,
  showModal,
}: {
  editor: LexicalEditor;
  disabled?: boolean;
  showModal: ShowModal;
}) {
  return (
    <ToolbarMenu
      label="Insert"
      icon={Plus}
      trigger={<span className="hidden sm:inline">Insert</span>}
      disabled={disabled}
      contentClassName="min-w-52"
    >
      <InsertItems editor={editor} showModal={showModal} />
    </ToolbarMenu>
  );
}
