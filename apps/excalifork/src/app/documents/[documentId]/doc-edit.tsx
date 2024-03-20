"use client";

import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { MarkNode } from "@lexical/mark";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { Theme } from "./themes/themes";
import ToolbarPlugin from "./plugins/toolbar-plugin";
import TreeViewPlugin from "./plugins/tree-view-plugin";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import env from "@packages/env";

const initialMarkdown = `# Welcome to Lexical
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5

This is a list:
- List item 1
- List item 2
- List item 3

This is a numbered list
1. List item 1
2. List item 2
3. List item 3

[Link](https://lexical.dev)

Here's a piece of code:
\`Hello world!\`
`;

const initialEditorState = () => {
  return $convertFromMarkdownString(initialMarkdown, TRANSFORMERS);
};

function Placeholder() {
  return (
    <div className="absolute p-20 text-gray-600 dark:text-gray-100 select-none pointer-events-none">
      Enter some rich text...
    </div>
  );
}

export default function DocumentEditor() {
  const isDarkTheme = useIsDarkTheme();
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "React.js Demo",
        nodes: [
          MarkNode,
          HeadingNode,
          QuoteNode,
          LinkNode,
          ListNode,
          ListItemNode,
          HorizontalRuleNode,
          CodeNode,
        ],
        onError(error: Error) {
          throw error;
        },
        theme: Theme,
        editorState: initialEditorState,
      }}
    >
      <div className="min-h-screen w-[100wv] bg-zinc-50 dark:bg-zinc-950 flex justify-center items-center">
        <div className="w-full px-4 md:px-8 lg:max-w-4xl xl:max-w-5xl fixed top-3 z-50">
          <div className="flex justify-between items-center py-2">
            {/* Placeholder for additional elements or empty div if nothing is on the left */}
            <div></div>
            <ToolbarPlugin />
            <div className="flex gap-3 px-4 py-2 bg-white backdrop-blur-lg shadow-lg dark:border-slate-600 dark:bg-zinc-800 rounded-lg">
              <ModeToggle />
            </div>
          </div>
        </div>
        <div className="mt-14 pt-10 px-4 md:px-8 shadow-lg rounded-lg overflow-hidden w-[960px]">
          <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="min-h-[100vh] h-auto resize-none outline-none text-black dark:text-white" />
            }
            placeholder={<Placeholder />}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <AutoFocusPlugin />
          {/*  */}
          {env.NEXT_PUBLIC_NODE_ENV === "development" && <TreeViewPlugin />}
        </div>
      </div>
    </LexicalComposer>
  );
}
