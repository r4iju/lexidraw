import type { EditorThemeClasses } from "lexical";

export const theme = {
  code: "document-code-body",
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
  // The comment plugin marks the range of the thread in focus, and of
  // settled threads, through data-comment.
  mark: "bg-comment-mark text-foreground border-b-2 border-comment-border data-[comment=active]:bg-comment-mark-active data-[comment=resolved]:bg-transparent data-[comment=resolved]:border-transparent",
  autocomplete: "text-muted-foreground",
  table: "document-table",
  tableScrollableWrapper: "document-table-region",
  tableAddColumns:
    "absolute top-0 right-[-25px] w-5 h-full bg-muted hover:bg-accent transition-colors",
  tableAddRows:
    "absolute left-0 bottom-[-25px] h-5 w-[calc(100%-25px)] bg-muted hover:bg-accent transition-colors",
  tableCell: "relative outline-hidden",
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
  heading: { h1: "", h2: "", h3: "", h4: "", h5: "", h6: "" },
  image: "editor-image",
  embedBlock: {
    base: "document-embed-block",
    focus: "document-embed-selected",
  },
  link: "document-link",
  list: {
    // For bullet-lists (top-level <ul>)
    ul: "p-0 m-0 list-outside",

    // For numeric-lists (top-level <ol>)
    ol: "p-0 m-0 list-decimal list-outside",

    // For checklists (top-level <ul> with type='check')
    checklist: "p-0 m-0 list-none",

    // Common <li> base styling
    listitem: "",

    // Checklists:
    listitemUnchecked: "document-task",
    listitemChecked: "document-task document-task-done",
    nested: {
      listitem: "list-none before:hidden after:hidden",
    },

    olDepth: ["list-decimal", "list-lower-alpha", "list-lower-roman"],

    ulDepth: [
      "list-disc", //   list-style-type: disc
      "list-circle", // list-style-type: circle
      "list-square", // list-style-type: square
    ],
  },

  ltr: "text-left",
  paragraph: "relative",
  placeholder:
    "text-muted top-4 left-3 absolute text-sm font-medium pointer-events-none inline-block",
  quote: "document-quote",
  rtl: "text-right",
  text: {
    highlight: "bg-highlight text-foreground rounded-[2px]",
    code: "document-inline-code",
    bold: "font-bold text-foreground",
    hashtag: "editor-text-hashtag text-info",
    italic: "italic text-foreground",
    overflowed: "editor-text-overflowed text-foreground",
    strikethrough: "line-through text-foreground",
    underline: "underline text-foreground",
    underlineStrikethrough: "underline line-through text-foreground",
  },
  layoutContainer: "grid gap-2",
  // The dashed outline shows an editor where a column ends; a reader and
  // paper see the columns without it.
  layoutItem:
    "document-column border border-dashed border-muted p-2 [[aria-readonly=true]_&]:border-transparent print:border-transparent",
} satisfies EditorThemeClasses;
