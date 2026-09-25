import type { Option, Options } from "./PollNode";
import { PollNode } from "./PollNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  type BaseSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type NodeKey,
} from "lexical";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { TrashIcon } from "lucide-react";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";

function getTotalVotes(options: Options): number {
  return options.reduce((totalVotes, next) => {
    return totalVotes + next.votes.length;
  }, 0);
}

function PollOptionComponent({
  option,
  index,
  options,
  totalVotes,
  nodeKey,
  withPollNode,
}: {
  index: number;
  option: Option;
  options: Options;
  totalVotes: number;
  nodeKey: NodeKey;
  withPollNode: (
    cb: (pollNode: PollNode) => void,
    onSelect?: () => void,
  ) => void;
}): React.JSX.Element {
  const userId = useUserIdOrGuestId();
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const checkboxRef = useRef(null);
  const votesArray = option.votes;
  const checkedIndex = votesArray.indexOf(userId);
  const checked = checkedIndex !== -1;
  const votes = votesArray.length;
  const text = option.text;

  return (
    <div className="flex items-center mb-2">
      {isEditable && (
        <Checkbox
          ref={checkboxRef}
          onCheckedChange={() => {
            withPollNode((node) => {
              node.toggleVote(option, userId);
            });
          }}
          className="mr-2 size-6 print:hidden"
          checked={checked}
        />
      )}

      <div className="relative flex flex-col min-w-0 flex-grow rounded-md border border-primary overflow-hidden">
        <meter
          aria-label={text}
          min={0}
          max={100}
          value={totalVotes ? Math.round((votes / totalVotes) * 100) : 0}
          className="sr-only"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 origin-left bg-primary/10 transition-transform duration-slow"
          style={{
            transform: `scaleX(${votes === 0 ? 0 : votes / totalVotes})`,
          }}
        />
        {isEditable ? (
          <Input
            className={cn(
              "relative z-10 min-w-0 flex-1 border-0 bg-transparent p-2 font-semibold print:hidden",
              "text-primary placeholder:text-muted-foreground placeholder:font-normal",
              "focus-visible:ring-0",
            )}
            type="text"
            value={text}
            onKeyDownCapture={(e) => e.stopPropagation()}
            onChange={(e) =>
              editor.update(() => {
                const n = $getNodeByKey(nodeKey);
                if (PollNode.$isPollNode(n)) {
                  n.setOptionText(option, e.target.value);
                }
              })
            }
            placeholder={`Option ${index + 1}`}
          />
        ) : null}
        <span
          className={cn(
            "relative z-10 p-2 font-semibold text-primary",
            isEditable && "hidden print:block",
          )}
        >
          {text}
        </span>
        <span className="relative z-10 px-2 pb-2 text-xs text-primary">
          {votes} {votes === 1 ? "vote" : "votes"} ·{" "}
          {totalVotes ? Math.round((votes / totalVotes) * 100) : 0}%
        </span>
      </div>
      {isEditable && (
        <Button
          disabled={options.length < 3}
          size="icon"
          className={cn(
            "ml-2 size-7 shrink-0 rounded-sm print:hidden",
            "opacity-30 hover:opacity-100",
            "disabled:pointer-events-none disabled:opacity-30",
          )}
          aria-label="Remove"
          onClick={() => {
            withPollNode((node) => {
              node.deleteOption(option);
            });
          }}
        >
          <TrashIcon className="size-4" />
        </Button>
      )}
    </div>
  );
}

export default function PollComponent({
  question,
  options,
  nodeKey,
}: {
  nodeKey: NodeKey;
  options: Options;
  question: string;
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const totalVotes = useMemo(() => getTotalVotes(options), [options]);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [selection, setSelection] = useState<BaseSelection | null>(null);
  const ref = useRef(null);

  const $onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        const event: KeyboardEvent = payload;
        event.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if (PollNode.$isPollNode(node)) {
          node.remove();
          return true;
        }
      }
      return false;
    },
    [isSelected, nodeKey],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        setSelection(editorState.read(() => $getSelection()));
      }),
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (payload) => {
          const event = payload;

          if (event.target === ref.current) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            return true;
          }

          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [clearSelection, editor, isSelected, $onDelete, setSelected]);

  const withPollNode = (
    cb: (node: PollNode) => void,
    onUpdate?: () => void,
  ): void => {
    editor.update(
      () => {
        const node = $getNodeByKey(nodeKey);
        if (PollNode.$isPollNode(node)) {
          cb(node);
        }
      },
      { onUpdate },
    );
  };

  const addOption = () => {
    withPollNode((node) => {
      node.addOption(PollNode.createPollOption());
    });
  };

  const isFocused = $isNodeSelection(selection) && isSelected;

  return (
    <div
      className={cn(
        "w-full max-w-[520px] min-w-0 mx-auto select-none rounded-lg",
        "border border-border bg-card p-6",
        { "outline-2 outline-ring": isFocused && isEditable },
      )}
      data-poll=""
      ref={ref}
    >
      <h2 className="mb-4 text-center text-lg font-medium text-foreground">
        {question}
      </h2>
      {options.map((option, index) => {
        const key = option.uid;
        return (
          <PollOptionComponent
            key={key}
            nodeKey={nodeKey}
            withPollNode={withPollNode}
            option={option}
            index={index}
            options={options}
            totalVotes={totalVotes}
          />
        );
      })}
      <p className="text-sm text-muted-foreground">
        {totalVotes} {totalVotes === 1 ? "vote" : "votes"} total
      </p>
      {isEditable && (
        <div className="flex justify-center print:hidden">
          <Button onClick={addOption} size="sm">
            Add Option
          </Button>
        </div>
      )}
    </div>
  );
}
