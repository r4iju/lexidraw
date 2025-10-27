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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState as useReactState,
} from "react";
import YoutubeIcon from "~/components/icons/youtube";
import { TwitterIcon } from "~/components/icons/twitter";
import { FigmaIcon } from "~/components/icons/figma";
import {
  INSERT_ARTICLE_ENTITY_COMMAND,
  INSERT_ARTICLE_URL_COMMAND,
} from "../ArticlePlugin";
import { api } from "~/trpc/react";
import { FileText } from "lucide-react";
import Image from "next/image";
import { useIsDarkTheme } from "~/components/theme/theme-provider";

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
    icon: <FileText className="size-4" />,
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
      <ul className="list-none p-0 m-0 max-h-[80vh] overflow-y-auto">
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
  const isArticle = embedConfig.type === "article";
  const [tab, setTab] = useReactState<"url" | "saved">("url");
  const isDarkTheme = useIsDarkTheme();

  // Saved search state (Article only)
  const [savedQuery, setSavedQuery] = useReactState("");
  const [selectedTags, setSelectedTags] = useReactState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useReactState(false);
  const [includeArchived, setIncludeArchived] = useReactState(false);
  const [sortBy, setSortBy] = useReactState<
    "updatedAt" | "createdAt" | "title"
  >("updatedAt");
  const [sortOrder, setSortOrder] = useReactState<"asc" | "desc">("desc");

  const userTags = api.entities.getUserTags.useQuery(undefined, {
    enabled: isArticle && tab === "saved",
  });
  const savedSearch = api.entities.search.useQuery(
    { query: savedQuery },
    { enabled: isArticle && tab === "saved" && savedQuery.trim().length > 0 },
  );
  const savedList = api.entities.list.useQuery(
    {
      parentId: null,
      sortBy,
      sortOrder,
      tagNames: selectedTags,
      includeArchived,
      onlyFavorites,
      entityTypes: ["url"],
    },
    { enabled: isArticle && tab === "saved" && savedQuery.trim().length === 0 },
  );

  type SavedEntity = {
    id: string;
    title: string;
    screenShotLight: string;
    screenShotDark: string;
    entityType: string;
    updatedAt?: string | Date | null;
  };
  const savedItems = useMemo<SavedEntity[]>(() => {
    if (!isArticle || tab !== "saved") return [] as SavedEntity[];
    const base =
      savedQuery.trim().length > 0
        ? (savedSearch.data ?? [])
        : (savedList.data ?? []);
    const urls = (base as unknown as SavedEntity[]).filter(
      (e) => e.entityType === "url",
    );
    return urls;
  }, [isArticle, tab, savedQuery, savedSearch.data, savedList.data]);

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

  if (!isArticle) {
    return (
      <DialogContent className="p-4 overflow-hidden">
        <div className="flex flex-col h-full min-w-0 max-w-full">
          <div className="sticky top-0 z-10 bg-background/80 backdrop-blur">
            <DialogHeader>
              <DialogTitle className="text-base md:text-lg">
                Embed {embedConfig.contentName}
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain break-words break-all">
            <Input
              type="text"
              className="w-full min-w-0"
              placeholder={embedConfig.exampleUrl}
              value={text}
              onChange={(e) => {
                const { value } = e.target;
                setText(value);
                validateText(value);
              }}
            />
          </div>
          <div className="sticky bottom-0 z-10 bg-background/80 backdrop-blur">
            <DialogFooter>
              <Button
                disabled={!embedResult}
                onClick={onClick}
                className="w-full md:w-auto"
              >
                Embed
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    );
  }

  // Specialized Article dialog with tabs
  return (
    <DialogContent className="p-4 overflow-hidden">
      <div className="flex flex-col h-full min-w-0 max-w-full">
        <DialogHeader className="sticky top-0 z-10">
          <DialogTitle className="text-base md:text-lg">
            Embed Article
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 mt-2 pb-4">
          <Button
            variant={tab === "url" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("url")}
          >
            From URL
          </Button>
          <Button
            variant={tab === "saved" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("saved")}
          >
            From saved
          </Button>
        </div>

        <div className="overflow-y-auto break-words break-all flex flex-col gap-4 min-w-0 max-w-full">
          {tab === "url" && (
            <div className="space-y-4 p-1">
              <Input
                type="text"
                className="w-full min-w-0"
                placeholder={embedConfig.exampleUrl}
                value={text}
                onChange={(e) => {
                  const { value } = e.target;
                  setText(value);
                  validateText(value);
                }}
              />
            </div>
          )}
          {tab === "saved" && (
            <>
              <div className="flex gap-2 p-1">
                <Input
                  placeholder="Search saved articles"
                  value={savedQuery}
                  onChange={(e) => setSavedQuery(e.target.value)}
                  className="flex-1 min-w-0"
                />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex gap-2 items-center">
                  <Button
                    size="sm"
                    variant={onlyFavorites ? "secondary" : "outline"}
                    onClick={() => setOnlyFavorites((v) => !v)}
                  >
                    Favorites
                  </Button>
                  <Button
                    size="sm"
                    variant={includeArchived ? "secondary" : "outline"}
                    onClick={() => setIncludeArchived((v) => !v)}
                  >
                    Archived
                  </Button>
                </div>
                <div className="flex gap-2 items-center">
                  <select
                    className="border border-border rounded-md bg-background px-2 py-1 text-sm"
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(
                        e.target.value as "updatedAt" | "createdAt" | "title",
                      )
                    }
                  >
                    <option value="updatedAt">Updated</option>
                    <option value="createdAt">Created</option>
                    <option value="title">Title</option>
                  </select>
                  <select
                    className="border border-border rounded-md bg-background px-2 py-1 text-sm"
                    value={sortOrder}
                    onChange={(e) =>
                      setSortOrder(e.target.value as "asc" | "desc")
                    }
                  >
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {((userTags.data as string[] | undefined) ?? []).map(
                  (tag: string) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <Button
                        key={tag}
                        size="sm"
                        asChild={false}
                        variant={active ? "secondary" : "outline"}
                        onClick={() =>
                          setSelectedTags((prev) =>
                            prev.includes(tag)
                              ? prev.filter((t) => t !== tag)
                              : [...prev, tag],
                          )
                        }
                      >
                        {tag}
                      </Button>
                    );
                  },
                )}
              </div>
              <div className="flex flex-col max-h-[70vh] overflow-y-auto overflow-x-hidden gap-1 min-w-0 max-w-full">
                {savedItems.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-3 min-w-0 overflow-hidden border border-border rounded-md"
                    onClick={() => {
                      editor.dispatchCommand(
                        INSERT_ARTICLE_ENTITY_COMMAND,
                        e.id,
                      );
                      onClose();
                    }}
                  >
                    {e.screenShotLight && e.screenShotDark ? (
                      <div className="relative shrink-0 size-10 overflow-hidden rounded-md">
                        <Image
                          src={
                            isDarkTheme ? e.screenShotDark : e.screenShotLight
                          }
                          alt="thumbnail"
                          width={40}
                          height={40}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="relative shrink-0 size-10 overflow-hidden rounded-md bg-muted" />
                    )}
                    <div className="min-w-0 max-w-full">
                      <div className="text-sm font-medium break-words break-all truncate">
                        {e.title}
                      </div>
                      <div className="text-xs text-muted-foreground break-words break-all truncate">
                        {e.id}
                      </div>
                    </div>
                  </button>
                ))}
                {savedItems.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    No results
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 pt-4">
          {tab === "url" ? (
            <Button
              disabled={!embedResult}
              onClick={onClick}
              className="w-full md:w-auto"
            >
              Embed
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={onClose}
              className="w-full md:w-auto"
            >
              Close
            </Button>
          )}
        </DialogFooter>
      </div>
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
