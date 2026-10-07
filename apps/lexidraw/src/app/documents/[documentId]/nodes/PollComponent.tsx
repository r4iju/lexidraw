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
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";
import { PlusIcon, XIcon } from "lucide-react";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";

function getTotalVotes(options: Options): number {
  return options.reduce((totalVotes, next) => {
    return totalVotes + next.votes.length;
  }, 0);
}

/**
 * Edit controls stay out of the way until the poll is pointed at, holds
 * focus, or is selected as a block.
 */
const editControl = (revealed: boolean) =>
  cn(
    "transition-opacity duration-fast print:hidden",
    revealed
      ? "opacity-100"
      : "opacity-0 group-hover/poll:opacity-100 group-focus-within/poll:opacity-100 focus-visible:opacity-100",
  );

function PollOptionComponent({
  option,
  index,
  options,
  totalVotes,
  nodeKey,
  revealed,
  withPollNode,
}: {
  index: number;
  option: Option;
  options: Options;
  totalVotes: number;
  nodeKey: NodeKey;
  revealed: boolean;
  withPollNode: (
    cb: (pollNode: PollNode) => void,
    onSelect?: () => void,
  ) => void;
}): React.JSX.Element {
  const userId = useUserIdOrGuestId();
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const labelId = useId();
  const votesArray = option.votes;
  const checked = votesArray.includes(userId);
  const votes = votesArray.length;
  const text = option.text;
  const percentage = totalVotes ? Math.round((votes / totalVotes) * 100) : 0;
  const label = text || `Option ${index + 1}`;

  return (
    <li className="py-1.5">
      <div className="flex items-start gap-3">
        {isEditable && (
          <Checkbox
            onCheckedChange={() => {
              withPollNode((node) => {
                node.toggleVote(option, userId);
              });
            }}
            aria-labelledby={labelId}
            className={cn(
              "mt-[3px] size-[18px] rounded-[5px] print:hidden",
              "data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background",
              "dark:data-[state=checked]:bg-foreground",
            )}
            checked={checked}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            {isEditable ? (
              <textarea
                id={labelId}
                aria-label={label}
                rows={1}
                className={cn(
                  "min-w-0 flex-1 resize-none bg-transparent p-0 text-foreground outline-none [field-sizing:content]",
                  "placeholder:text-muted-foreground print:hidden",
                )}
                value={text}
                onKeyDownCapture={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.preventDefault();
                }}
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
              id={isEditable ? undefined : labelId}
              className={cn(
                "min-w-0 flex-1 text-foreground",
                isEditable && "hidden print:block",
              )}
            >
              {text}
            </span>
            {totalVotes > 0 && (
              <span className="shrink-0 pt-px text-sm tabular-nums text-muted-foreground">
                {votes} {votes === 1 ? "vote" : "votes"} · {percentage}%
              </span>
            )}
            {isEditable && (
              <button
                type="button"
                disabled={options.length < 3}
                className={cn(
                  "-my-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
                  "hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  "disabled:invisible",
                  editControl(revealed),
                )}
                aria-label={`Remove ${label}`}
                title="Remove option"
                onClick={() => {
                  withPollNode((node) => {
                    node.deleteOption(option);
                  });
                }}
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
          <div
            data-poll-bar=""
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <meter
              aria-label={label}
              min={0}
              max={100}
              value={percentage}
              className="sr-only"
            />
            <div
              aria-hidden="true"
              className={cn(
                "h-full origin-left rounded-full transition-transform duration-slow",
                checked ? "bg-foreground/80" : "bg-foreground/35",
              )}
              style={{
                transform: `scaleX(${votes === 0 ? 0 : votes / totalVotes})`,
              }}
            />
          </div>
        </div>
      </div>
    </li>
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

  // Lexical's selection and commands.
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
  const isEmpty = options.length === 0;

  return (
    <div
      className={cn(
        "group/poll w-full max-w-[520px] min-w-0 mx-auto select-none rounded-lg text-start",
        "border border-border bg-card px-4 pt-3 pb-2",
        { "outline-2 outline-ring": isFocused && isEditable },
      )}
      data-poll=""
      ref={ref}
    >
      <p className="mb-1 font-semibold text-foreground">{question}</p>
      {isEmpty ? (
        <p className="py-1.5 text-sm text-muted-foreground">No options yet</p>
      ) : (
        <ul>
          {options.map((option, index) => (
            <PollOptionComponent
              key={option.uid}
              nodeKey={nodeKey}
              withPollNode={withPollNode}
              option={option}
              index={index}
              options={options}
              totalVotes={totalVotes}
              revealed={isFocused}
            />
          ))}
        </ul>
      )}
      <div className="flex min-h-8 items-center justify-between gap-3 text-sm text-muted-foreground">
        {!isEmpty && (
          <span className="tabular-nums">
            {totalVotes === 0
              ? "No votes yet"
              : `${totalVotes} ${totalVotes === 1 ? "vote" : "votes"} total`}
          </span>
        )}
        {isEditable && (
          <button
            type="button"
            onClick={addOption}
            className={cn(
              "-mx-2 flex items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-accent hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-ring",
              editControl(isFocused || isEmpty),
            )}
          >
            <PlusIcon className="size-4" />
            Add option
          </button>
        )}
      </div>
    </div>
  );
}
