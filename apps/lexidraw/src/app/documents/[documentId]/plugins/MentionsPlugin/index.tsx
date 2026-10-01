import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { TextNode } from "lexical";
import { useCallback, useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { TypeaheadMenu } from "../typeahead-menu";

import {
  matchAtSignMention,
  lookupMentions,
  selectMention,
  MENTION_LOOKUP_DELAY,
  SUGGESTION_LIST_LENGTH_LIMIT,
} from "./source";

const mentionsCache = new Map();

const dummyLookupService = {
  search(string: string, callback: (results: string[]) => void): void {
    setTimeout(() => {
      const results = lookupMentions(string);
      callback(results);
    }, MENTION_LOOKUP_DELAY);
  },
};

function useMentionLookupService(mentionString: string | null) {
  const [results, setResults] = useState<string[]>([]);

  useEffect(() => {
    const cachedResults = mentionsCache.get(mentionString);

    if (mentionString == null) {
      setResults([]);
      return;
    }

    if (cachedResults === null) {
      return;
    } else if (cachedResults !== undefined) {
      setResults(cachedResults);
      return;
    }

    mentionsCache.set(mentionString, null);
    dummyLookupService.search(mentionString, (newResults) => {
      mentionsCache.set(mentionString, newResults);
      setResults(newResults);
    });
  }, [mentionString]);

  return results;
}

class MentionTypeaheadOption extends MenuOption {
  name: string;

  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function NewMentionsPlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  const [queryString, setQueryString] = useState<string | null>(null);

  const results = useMentionLookupService(queryString);

  const checkForSlashTriggerMatch = useBasicTypeaheadTriggerMatch("/", {
    minLength: 0,
  });

  const options = useMemo(
    () =>
      results
        .map((result) => new MentionTypeaheadOption(result))
        .slice(0, SUGGESTION_LIST_LENGTH_LIMIT),
    [results],
  );

  const onSelectOption = useCallback(
    (
      selectedOption: MentionTypeaheadOption,
      nodeToReplace: TextNode | null,
      closeMenu: () => void,
    ) => {
      selectMention(editor, selectedOption.name, nodeToReplace, closeMenu);
    },
    [editor],
  );

  const checkForAtSignMentions = useCallback(
    (text: string, minMatchLength: number): MenuTextMatch | null => {
      return matchAtSignMention(text, minMatchLength);
    },
    [],
  );

  const getPossibleQueryMatch = useCallback(
    (text: string): MenuTextMatch | null => {
      return checkForAtSignMentions(text, 1);
    },
    [checkForAtSignMentions],
  );

  const checkForMentionMatch = useCallback(
    (text: string) => {
      const slashMatch = checkForSlashTriggerMatch(text, editor);
      if (slashMatch !== null) {
        return null;
      }
      return getPossibleQueryMatch(text);
    },
    [checkForSlashTriggerMatch, editor, getPossibleQueryMatch],
  );

  return (
    <LexicalTypeaheadMenuPlugin<MentionTypeaheadOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForMentionMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => (
        <TypeaheadMenu
          anchor={anchorElementRef.current}
          label="People"
          options={options}
          selectedIndex={selectedIndex}
          onSelect={(option, index) => {
            setHighlightedIndex(index);
            selectOptionAndCleanUp(option);
          }}
          onHighlight={setHighlightedIndex}
          picture={(option) => <Avatar name={option.name} />}
          name={(option) => option.name}
        />
      )}
    />
  );
}
