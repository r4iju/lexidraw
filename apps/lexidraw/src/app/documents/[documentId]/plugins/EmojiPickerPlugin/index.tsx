import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type TextNode,
} from "lexical";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TypeaheadMenu } from "../typeahead-menu";

class EmojiOption extends MenuOption {
  title: string;
  emoji: string;
  keywords: string[];

  constructor(
    title: string,
    emoji: string,
    options: {
      keywords?: string[];
    },
  ) {
    super(title);
    this.title = title;
    this.emoji = emoji;
    this.keywords = options.keywords || [];
  }
}
type Emoji = {
  emoji: string;
  description: string;
  category: string;
  aliases: string[];
  tags: string[];
  unicode_version: string;
  ios_version: string;
  skin_tones?: boolean;
};

const MAX_EMOJI_SUGGESTION_COUNT = 10;

export default function EmojiPickerPlugin() {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);
  const [emojis, setEmojis] = useState<Emoji[]>([]);

  useEffect(() => {
    import("@packages/lexical-nodes/emoji-list").then((file) =>
      setEmojis(file.default),
    );
  }, []);

  const emojiOptions = useMemo(
    () =>
      emojis != null
        ? emojis.map(
            ({ emoji, aliases, tags }) =>
              new EmojiOption(aliases[0] ?? "", emoji, {
                keywords: [...aliases, ...tags],
              }),
          )
        : [],
    [emojis],
  );

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch(":", {
    minLength: 0,
  });

  const options: EmojiOption[] = useMemo(() => {
    const query = queryString?.toLowerCase() ?? "";
    return emojiOptions
      .filter((option) =>
        option.keywords.some((keyword) =>
          keyword.toLowerCase().includes(query),
        ),
      )
      .slice(0, MAX_EMOJI_SUGGESTION_COUNT);
  }, [emojiOptions, queryString]);

  const onSelectOption = useCallback(
    (
      selectedOption: EmojiOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || selectedOption == null) {
          return;
        }

        if (nodeToRemove) {
          nodeToRemove.remove();
        }

        selection.insertNodes([$createTextNode(selectedOption.emoji)]);

        closeMenu();
      });
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => (
        <TypeaheadMenu
          anchor={anchorElementRef.current}
          label="Emoji"
          options={options}
          selectedIndex={selectedIndex}
          onSelect={(option, index) => {
            setHighlightedIndex(index);
            selectOptionAndCleanUp(option);
          }}
          onHighlight={setHighlightedIndex}
          picture={(option) => option.emoji}
          name={(option) => option.title}
        />
      )}
    />
  );
}
