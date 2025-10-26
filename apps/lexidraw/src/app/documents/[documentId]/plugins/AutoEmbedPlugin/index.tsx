import type { LexicalEditor } from "lexical";
import {
  AutoEmbedOption,
  type EmbedConfig,
  type EmbedMatchResult,
  LexicalAutoEmbedPlugin,
  URL_MATCHER,
} from "@lexical/react/LexicalAutoEmbedPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useState } from "react";
import type * as React from "react";
import * as ReactDOM from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { INSERT_FIGMA_COMMAND } from "../FigmaPlugin";
import { INSERT_TWEET_COMMAND } from "../TwitterPlugin";
import { INSERT_YOUTUBE_COMMAND } from "../YouTubePlugin";
import { Input } from "~/components/ui/input";
import { useCallback, useEffect, useRef } from "react";
import YoutubeIcon from "~/components/icons/youtube";
import { TwitterIcon } from "~/components/icons/twitter";
import { FigmaIcon } from "~/components/icons/figma";
import { INSERT_ARTICLE_URL_COMMAND } from "../ArticlePlugin";

interface PlaygroundEmbedConfig extends EmbedConfig {
  contentName: string;
  icon?: React.JSX.Element;
  exampleUrl: string;
  keywords: string[];
  description?: string;
}

export const useEmbedConfigs = () => {
  const YoutubeEmbedConfig: PlaygroundEmbedConfig = {
    contentName: "Youtube Video",
    exampleUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    icon: <YoutubeIcon className="size-4" />,
    insertNode: (editor: LexicalEditor, result: EmbedMatchResult) => {
      editor.dispatchCommand(INSERT_YOUTUBE_COMMAND, result.id);
    },
    keywords: ["youtube", "video"],
    parseUrl: async (url: string) => {
      const match =
        /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/.exec(
          url,
        );
      const id = match
        ? (match?.[2] as string).length === 11
          ? match[2]
          : null
        : null;
      if (id != null) {
        return { id, url };
      }
      return null;
    },
    type: "youtube-video",
  };

  const ArticleEmbedConfig: PlaygroundEmbedConfig = {
    contentName: "Article",
    exampleUrl: "https://example.com/news/article",
    icon: undefined,
    insertNode: async (editor: LexicalEditor, result: EmbedMatchResult) => {
      editor.dispatchCommand(INSERT_ARTICLE_URL_COMMAND, result.url);
    },
    keywords: ["http", "https", "article", "news", "blog"],
    parseUrl: async (url: string) => {
      try {
        const u = new URL(url);
        if (u.protocol === "http:" || u.protocol === "https:") {
          return { id: url, url };
        }
      } catch {
        // noop
      }
      return null;
    },
    type: "article",
  };

  const TwitterEmbedConfig: PlaygroundEmbedConfig = {
    contentName: "Tweet",
    exampleUrl: "https://twitter.com/jack/status/20",
    icon: <TwitterIcon className="size-4" />,
    insertNode: (editor: LexicalEditor, result: EmbedMatchResult) => {
      editor.dispatchCommand(INSERT_TWEET_COMMAND, result.id);
    },
    keywords: ["tweet", "twitter", "x"],
    parseUrl: (text: string) => {
      const match =
        /^https:\/\/(twitter|x)\.com\/(#!\/)?(\w+)\/status(es)*\/(\d+)/.exec(
          text,
        );
      if (match != null) {
        return { id: match[5] as string, url: match[1] as string };
      }
      return null;
    },
    type: "tweet",
  };

  const FigmaEmbedConfig: PlaygroundEmbedConfig = {
    contentName: "Figma Document",
    exampleUrl: "https://www.figma.com/file/LKQ4FJ4bTnCSjedbRpk931/Sample-File",
    icon: <FigmaIcon className="size-4" />,
    insertNode: (editor: LexicalEditor, result: EmbedMatchResult) => {
      editor.dispatchCommand(INSERT_FIGMA_COMMAND, result.id);
    },
    keywords: ["figma", "figma.com", "mock-up"],
    parseUrl: (text: string) => {
      const match =
        /https:\/\/([\w.-]+\.)?figma.com\/(file|proto)\/([0-9a-zA-Z]{22,128})(?:\/.*)?$/.exec(
          text,
        );
      if (match != null) {
        return { id: match[3] as string, url: match[0] as string };
      }
      return null;
    },
    type: "figma",
  };

  const EmbedConfigs = [
    TwitterEmbedConfig,
    YoutubeEmbedConfig,
    FigmaEmbedConfig,
    ArticleEmbedConfig,
  ];

  return EmbedConfigs;
};

function AutoEmbedMenuItem({
  index,
  isSelected,
  onClick,
  onMouseEnter,
  option,
}: {
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  option: AutoEmbedOption;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: todo: fix key with click events
    <li
      key={option.key}
      tabIndex={-1}
      className="flex items-center px-2 py-1.5 text-sm rounded-sm cursor-default select-none outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
      data-highlighted={isSelected ? "" : undefined}
      ref={option.setRefElement}
      id={`typeahead-item-${index}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="flex-grow">{option.title}</span>
    </li>
  );
}

function AutoEmbedMenu({
  options,
  selectedItemIndex,
  onOptionClick,
  onOptionMouseEnter,
}: {
  selectedItemIndex: number | null;
  onOptionClick: (option: AutoEmbedOption, index: number) => void;
  onOptionMouseEnter: (index: number) => void;
  options: AutoEmbedOption[];
}) {
  return (
    <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-lg p-1 z-50 w-[200px]">
      <ul className="list-none p-0 m-0">
        {options.map((option: AutoEmbedOption, i: number) => (
          <AutoEmbedMenuItem
            index={i}
            isSelected={selectedItemIndex === i}
            onClick={() => onOptionClick(option, i)}
            onMouseEnter={() => onOptionMouseEnter(i)}
            key={option.key}
            option={option}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Returns a stable debounced function that delays invoking `callback`
 * until after `delay` milliseconds have elapsed since the last time it was called.
 */
export function useDebouncedCallback(
  callback: (value: string) => void,
  delay: number,
) {
  // Remember the latest callback:
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Track the timeout ID in a ref so we can clear it
  const timeoutRef = useRef<number | null>(null);

  // Return a stable function reference:
  const debouncedFn = useCallback(
    (value: string) => {
      if (timeoutRef.current != null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        // call the latest callback
        callbackRef.current(value);
      }, delay);
    },
    [delay],
  );

  // Optionally expose a cancel method, etc.
  return debouncedFn;
}

export function AutoEmbedDialog({
  embedConfig,
  onClose,
}: {
  embedConfig: PlaygroundEmbedConfig;
  onClose: () => void;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [editor] = useLexicalComposerContext();
  const [embedResult, setEmbedResult] = useState<EmbedMatchResult | null>(null);

  const validateText = useDebouncedCallback((inputText: string) => {
    const urlMatch = URL_MATCHER.exec(inputText);
    if (embedConfig && inputText && urlMatch) {
      Promise.resolve(embedConfig.parseUrl(inputText)).then((parseResult) => {
        setEmbedResult(parseResult);
      });
    } else if (embedResult != null) {
      setEmbedResult(null);
    }
  }, 200);

  const onClick = () => {
    if (embedResult != null) {
      embedConfig.insertNode(editor, embedResult);
      onClose();
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Embed {embedConfig.contentName}</DialogTitle>
      </DialogHeader>
      <div className="w-full">
        <Input
          type="text"
          className="min-w-72"
          placeholder={embedConfig.exampleUrl}
          value={text}
          onChange={(e) => {
            const { value } = e.target;
            setText(value);
            validateText(value);
          }}
        />
      </div>
      <DialogFooter>
        <Button disabled={!embedResult} onClick={onClick}>
          Embed
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export default function AutoEmbedPlugin(): React.JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentEmbedConfig, setCurrentEmbedConfig] =
    useState<PlaygroundEmbedConfig | null>(null);

  const openEmbedModal = (embedConfig: PlaygroundEmbedConfig) => {
    setCurrentEmbedConfig(embedConfig);
    setIsDialogOpen(true);
  };

  const EmbedConfigs = useEmbedConfigs();

  const getMenuOptions = (
    activeEmbedConfig: PlaygroundEmbedConfig,
    embedFn: () => void,
    dismissFn: () => void,
  ) => {
    return [
      new AutoEmbedOption("Dismiss", {
        onSelect: dismissFn,
      }),
      new AutoEmbedOption(`Embed ${activeEmbedConfig.contentName}`, {
        onSelect: embedFn,
      }),
    ];
  };

  return (
    <>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        {currentEmbedConfig && (
          <AutoEmbedDialog
            embedConfig={currentEmbedConfig}
            onClose={() => setIsDialogOpen(false)}
          />
        )}
      </Dialog>
      <LexicalAutoEmbedPlugin<PlaygroundEmbedConfig>
        embedConfigs={EmbedConfigs}
        onOpenEmbedModalForConfig={openEmbedModal}
        getMenuOptions={getMenuOptions}
        menuRenderFn={(
          anchorElementRef,
          {
            selectedIndex,
            options,
            selectOptionAndCleanUp,
            setHighlightedIndex,
          },
        ) =>
          anchorElementRef.current
            ? ReactDOM.createPortal(
                <div
                  className="bg-popover text-popover-foreground border border-border rounded-md shadow-lg p-1 z-50"
                  style={{
                    marginLeft: `${Math.max(
                      parseFloat(anchorElementRef.current.style.width) - 200,
                      0,
                    )}px`,
                    width: 200,
                  }}
                >
                  <AutoEmbedMenu
                    options={options}
                    selectedItemIndex={selectedIndex}
                    onOptionClick={(option: AutoEmbedOption, index: number) => {
                      setHighlightedIndex(index);
                      selectOptionAndCleanUp(option);
                    }}
                    onOptionMouseEnter={(index: number) => {
                      setHighlightedIndex(index);
                    }}
                  />
                </div>,
                anchorElementRef.current,
              )
            : null
        }
      />
    </>
  );
}
