import type { LexicalEditor } from "lexical";
import { useId, useState } from "react";
import {
  CALLOUT_KINDS,
  CALLOUT_LABELS,
  type CalloutKind,
} from "@packages/lexical-nodes";
import { DialogFooter } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Radio } from "~/components/ui/radio";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { INSERT_CALLOUT_COMMAND } from ".";

export default function InsertCalloutDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<CalloutKind>("note");
  const [title, setTitle] = useState("");
  const ids = useId();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        activeEditor.dispatchCommand(INSERT_CALLOUT_COMMAND, { kind, title });
        onClose();
        // After the closing dialog hands focus back, so typing goes into the callout.
        requestAnimationFrame(() => activeEditor.focus());
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Kind</legend>
        {CALLOUT_KINDS.map((value) => (
          <label
            key={value}
            htmlFor={`${ids}-${value}`}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Radio
              id={`${ids}-${value}`}
              name="callout-kind"
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
            />
            {CALLOUT_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor="callout-title">Title (optional)</Label>
        <Input
          id="callout-title"
          value={title}
          placeholder={CALLOUT_LABELS[kind]}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="submit">Insert</Button>
      </DialogFooter>
    </form>
  );
}
