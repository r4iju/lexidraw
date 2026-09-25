import { INSERT_TABLE_COMMAND } from "@lexical/table";
import type { LexicalEditor } from "lexical";
import { type FormEvent, useId, useState } from "react";
import { DialogFooter } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export function InsertTableDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): React.JSX.Element {
  const id = useId();
  const [rows, setRows] = useState("5");
  const [columns, setColumns] = useState("5");
  const isDisabled = (() => {
    const row = Number(rows);
    const column = Number(columns);
    if (row && row > 0 && row <= 500 && column && column > 0 && column <= 50) {
      return false;
    } else {
      return true;
    }
  })();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isDisabled) return;
    activeEditor.dispatchCommand(INSERT_TABLE_COMMAND, {
      columns,
      rows,
    });

    onClose();
  };

  return (
    <form onSubmit={submit} className="contents">
      <Label htmlFor={`${id}-rows`}>Rows</Label>
      <Input
        id={`${id}-rows`}
        placeholder={"# of rows (1-500)"}
        onChange={(e) => setRows(e.target.value)}
        value={rows}
        type="number"
      />
      <Label htmlFor={`${id}-columns`}>Columns</Label>
      <Input
        id={`${id}-columns`}
        placeholder={"# of columns (1-50)"}
        onChange={(e) => setColumns(e.target.value)}
        value={columns}
        type="number"
      />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isDisabled}>
          Insert table
        </Button>
      </DialogFooter>
    </form>
  );
}
