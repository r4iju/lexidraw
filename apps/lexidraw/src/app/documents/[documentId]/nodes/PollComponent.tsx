import type { Option, Options } from "./PollNode";
import { PollNode } from "./PollNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
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
  const checkboxRef = useRef(null);
  const votesArray = option.votes;
  const checkedIndex = votesArray.indexOf(userId);
  const checked = checkedIndex !== -1;
  const votes = votesArray.length;
  const text = option.text;

  return (
    <div className="flex items-center mb-2">
      <Checkbox
        ref={checkboxRef}
        onCheckedChange={() => {
          withPollNode((node) => {
            node.toggleVote(option, userId);
          });
        }}
        className="mr-2 size-6"
        checked={checked}
      />

      <div className="relative flex flex-grow rounded-md border border-primary overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-1000 ease-in-out"
          style={{ width: `${votes === 0 ? 0 : (votes / totalVotes) * 100}%` }}
        />
        <span className="pointer-events-none absolute right-4 top-1 text-xs text-primary z-10">
          {votes > 0 && (votes === 1 ? "1 vote" : `${votes} votes`)}
        </span>
        <Input
          className={cn(
            "relative z-10 flex-1 border-0 bg-transparent p-2 font-semibold",
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
      </div>
      <Button
        disabled={options.length < 3}
        size="icon"
        className={cn(
          "ml-2 size-7 shrink-0 rounded-sm",
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
        "max-w-[600px] min-w-[400px] select-none rounded-lg",
        "border border-border bg-card p-6",
        { "outline-2 outline-ring": isFocused },
      )}
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
      <div className="flex justify-center">
        <Button onClick={addOption} size="sm">
          Add Option
        </Button>
      </div>
    </div>
  );
}
