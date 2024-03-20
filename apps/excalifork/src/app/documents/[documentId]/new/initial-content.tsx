import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";

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
` as const;

export const initialEditorState = () => {
  return $convertFromMarkdownString(initialMarkdown, TRANSFORMERS);
};

export const emptyContent = () => {
  return {
    root: {
      children: [
        {
          children: [],
          direction: null,
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
};
