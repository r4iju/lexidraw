import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { type TextNode } from "lexical";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  $selectEmoji,
  EMOJI_TRIGGER,
  EMOJI_MIN_LENGTH,
  emojiOptions as sourceOptions,
  emojiSuggestions,
} from "./options";
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
      sourceOptions(emojis).map(
        ({ title, emoji, keywords }) =>
          new EmojiOption(title, emoji, { keywords }),
      ),
    [emojis],
  );

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch(EMOJI_TRIGGER, {
    minLength: EMOJI_MIN_LENGTH,
  });

  const options: EmojiOption[] = useMemo(
    () => emojiSuggestions(emojiOptions, queryString),
    [emojiOptions, queryString],
  );

  const onSelectOption = useCallback(
    (
      selectedOption: EmojiOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        if (
          selectedOption == null ||
          !$selectEmoji(selectedOption.emoji, nodeToRemove)
        )
          return;

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
