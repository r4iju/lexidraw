import type { EditorThemeClasses } from "lexical";

export const theme = {
  code: `bg-input
    dark:bg-muted
    font-mono
    block
    overflow-x-auto
    my-4
    px-3
    pl-[52px]
    py-3
    text-[14px]
    leading-6
    rounded-md
    relative
    tab-size-[2]
    before:absolute
    before:content-[attr(data-gutter)]
    before:left-0
    before:top-0
    before:bg-muted
    before:border-r
    before:border-border
    before:p-2
    before:text-muted-foreground
    before:whitespace-pre-wrap
    before:text-right
    before:min-w-[25px]
    `,
  codeHighlight: {
    atrule: "text-syntax-keyword",
    attr: "text-syntax-function",
    boolean: "text-syntax-string",
    builtin: "text-syntax-literal",
    cdata: "text-muted-foreground",
    char: "text-syntax-keyword",
    class: "text-syntax-function",
    "class-name": "text-syntax-string",
    comment: "text-muted-foreground italic",
    constant: "text-syntax-keyword",
    deleted: "text-syntax-literal",
    doctype: "text-muted-foreground",
    entity: "text-syntax-keyword",
    function: "text-syntax-function",
    important: "text-syntax-literal",
    inserted: "text-syntax-string",
    keyword: "text-syntax-keyword",
    namespace: "text-syntax-keyword",
    number: "text-syntax-number",
    operator: "text-syntax-keyword",
    prolog: "text-muted-foreground",
    property: "text-syntax-string",
    punctuation: "text-foreground",
    regex: "text-syntax-literal",
    selector: "text-syntax-string",
    string: "text-syntax-string",
    symbol: "text-syntax-number",
    tag: "text-syntax-keyword",
    url: "text-syntax-function",
    variable: "text-syntax-keyword",
  },
  mark: "bg-comment-mark text-foreground border-b-2 border-comment-border",
  markFocused: "bg-comment-mark border-comment-border",
  autocomplete: "text-muted-foreground",
  table:
    "border-collapse border-spacing-0 overflow-x-auto overflow-y-auto table-fixed w-max my-8 rounded-md",
  tableAddColumns:
    "absolute top-0 right-[-25px] w-5 h-full bg-muted hover:bg-accent transition",
  tableAddRows:
    "absolute left-0 bottom-[-25px] h-5 w-[calc(100%-25px)] bg-muted hover:bg-accent transition",
  tableCell:
    "relative outline-hidden border border-border align-top text-start min-w-[75px] w-[75px] p-3 min-h-[40px]",
  tableCellHeader: "font-semibold",
  tableCellSelected: "bg-primary/10",
  tableCellPrimarySelected:
    "absolute inset-0 border-2 border-primary pointer-events-none",
  tableCellEditing: "shadow-md",
  tableCellSortedIndicator:
    "absolute bottom-0 left-0 w-full h-1 opacity-50 bg-muted-foreground",
  tableCellActionButtonContainer: "absolute top-[6px] right-[5px] z-10",
  tableCellActionButton:
    "w-5 h-5 rounded-full bg-muted hover:bg-muted cursor-pointer",
  tableCellResizer:
    "absolute right-[-4px] top-0 h-full w-2 cursor-ew-resize z-10",
  tableResizeRuler: "absolute top-0 h-full w-px bg-primary",
  tableSelection: "",
  tableSelected: "outline outline-2 outline-primary",
  heading: {
    h1: "text-3xl font-semibold leading-tight mt-8 mb-3 text-heading",
    h2: "text-2xl font-semibold leading-tight mt-6 mb-2 text-heading",
    h3: "text-xl font-semibold leading-snug mt-4 mb-2 text-heading",
    h4: "text-lg font-semibold mt-4 mb-1.5 text-heading",
    h5: "text-md font-semibold mt-3 mb-1 text-heading",
    h6: "text-sm font-semibold mt-3 mb-1 text-heading",
  },
  image: "editor-image",
  link: "inline-flex items-center font-medium text-primary hover:underline",
  list: {
    // For bullet-lists (top-level <ul>)
    ul: "p-0 m-0 list-outside",

    // For numeric-lists (top-level <ol>)
    ol: "p-0 m-0 list-decimal list-outside",

    // For checklists (top-level <ul> with type='check')
    checklist: "p-0 m-0 list-none",

    // Common <li> base styling
    listitem: "ml-6 my-1 pl-2",

    // Checklists:
    listitemUnchecked: `
      relative
      p-0
      mr-2
      !ml-0
      pl-8
      pr-8
      list-none
      outline-hidden
      before:absolute
      before:left-0
      before:top-1/2
      before:-translate-y-1/2
      before:size-5
      before:border
      before:border-input
      before:rounded
      before:bg-card
      before:content-['']
      before:cursor-pointer
    `,
    listitemChecked: `
      relative
      p-0
      mr-2
      !ml-0
      pl-8
      pr-8
      list-none
      outline-hidden
      line-through
      text-muted-foreground
      before:absolute
      before:left-0
      before:top-1/2
      before:-translate-y-1/2
      before:size-5
      before:border
      before:border-primary
      before:bg-primary
      before:rounded
      before:content-['']
      before:cursor-pointer
      after:absolute
      after:left-[7px]
      after:top-[45%]
      after:-translate-y-[45%]
      after:w-[6px]
      after:h-[10px]
      after:border-r-[2px]
      after:border-b-[2px]
      after:border-primary-foreground
      after:rotate-45
    `,
    nested: {
      listitem: "list-none before:hidden after:hidden",
    },

    // Depth-based arrays. For numeric lists:
    olDepth: [
      "p-0 m-0 list-outside list-decimal", //   list-style-type: decimal;
      "p-0 m-0 list-outside list-upper-alpha", //   list-style-type: upper-alpha;
      "p-0 m-0 list-outside list-lower-alpha", //   list-style-type: lower-alpha;
      "p-0 m-0 list-outside list-upper-roman", //   list-style-type: upper-roman;
      "p-0 m-0 list-outside list-lower-roman", //   list-style-type: lower-roman;
    ],

    ulDepth: [
      "list-disc", //   list-style-type: disc
      "list-circle", // list-style-type: circle
      "list-square", // list-style-type: square
    ],
  },

  ltr: "text-left",
  paragraph:
    "m-0 relative mb-2 leading-relaxed text-foreground [&:last-child]:mb-0",
  placeholder:
    "text-muted top-4 left-3 absolute text-sm font-medium pointer-events-none inline-block",
  quote: `m-0 ml-5 border-l-4 border-border px-5 py-3 text-foreground`,
  rtl: "text-right",
  text: {
    highlight: "bg-highlight text-foreground",
    code: `
      rounded-2xs
      text-muted-foreground
      bg-muted/60
      dark:bg-muted/40
      font-mono
      font-semibold
      overflow-x-auto
      py-0.5
      px-1.5
    `,
    bold: "font-bold text-foreground",
    hashtag: "editor-text-hashtag text-info",
    italic: "italic text-foreground",
    overflowed: "editor-text-overflowed text-foreground",
    strikethrough: "line-through text-foreground",
    underline: "underline text-foreground",
    underlineStrikethrough: "underline line-through text-foreground",
  },
  layoutContainer: "grid gap-2 my-2",
  // The dashed outline shows an editor where a column ends; a reader and
  // paper see the columns without it.
  layoutItem:
    "border border-dashed border-muted p-2 [[aria-readonly=true]_&]:border-transparent print:border-transparent",
  // codeBlock: "bg-muted font-mono block px-2 pl-13 py-2 leading-[1.53] text-[13px] my-2 overflow-x-auto relative tab-size-[2]",
  codeGutter:
    "absolute bg-accent left-0 top-0 border-r border-muted px-2 text-muted-foreground whitespace-pre-wrap text-right min-w-[25px]",
} satisfies EditorThemeClasses;
