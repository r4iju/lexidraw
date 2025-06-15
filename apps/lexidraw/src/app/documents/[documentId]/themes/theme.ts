import { type EditorThemeClasses } from "lexical";

export const theme = {
  code: `bg-input
    dark:bg-muted
    font-mono
    block
    overflow-x-auto
    my-2
    px-2
    pl-[52px]
    py-2
    text-[13px]
    leading-[1.53]
    relative
    tab-size-[2]
    before:absolute
    before:content-[attr(data-gutter)]
    before:left-0
    before:top-0
    before:bg-gray-200 dark:before:bg-gray-800
    before:border-r
    before:border-gray-300 dark:before:border-gray-700
    before:p-2
    before:text-gray-500 dark:before:text-gray-400
    before:whitespace-pre-wrap
    before:text-right
    before:min-w-[25px]
    `,
  codeHighlight: {
    atrule: "text-indigo-600 dark:text-indigo-400",
    attr: "text-blue-600 dark:text-blue-400",
    boolean: "text-green-600 dark:text-green-400",
    builtin: "text-red-600 dark:text-red-400",
    cdata: "text-gray-600 dark:text-gray-400",
    char: "text-pink-600 dark:text-pink-400",
    class: "text-blue-600 dark:text-blue-400",
    "class-name": "text-green-600 dark:text-green-400",
    comment: "text-gray-400 dark:text-gray-600 italic",
    constant: "text-purple-600 dark:text-purple-400",
    deleted: "text-red-600 dark:text-red-400",
    doctype: "text-gray-600 dark:text-gray-400",
    entity: "text-purple-600 dark:text-purple-400",
    function: "text-blue-600 dark:text-blue-400",
    important: "text-red-600 dark:text-red-400",
    inserted: "text-green-600 dark:text-green-400",
    keyword: "text-purple-600 dark:text-purple-400",
    namespace: "text-purple-600 dark:text-purple-400",
    number: "text-yellow-600 dark:text-yellow-400",
    operator: "text-pink-600 dark:text-pink-400",
    prolog: "text-gray-600 dark:text-gray-400",
    property: "text-teal-600 dark:text-teal-400",
    punctuation: "text-foreground",
    regex: "text-red-600 dark:text-red-400",
    selector: "text-green-600 dark:text-green-400",
    string: "text-teal-600 dark:text-teal-400",
    symbol: "text-orange-600 dark:text-orange-400",
    tag: "text-pink-600 dark:text-pink-400",
    url: "text-blue-600 dark:text-blue-400",
    variable: "text-indigo-600 dark:text-indigo-400",
  },
  autocomplete: "text-muted-foreground",
  table:
    "border-collapse border-spacing-0 overflow-x-auto overflow-y-auto table-fixed w-max my-8 rounded-md",
  tableAddColumns:
    "absolute top-0 right-[-25px] w-5 h-full bg-muted hover:bg-accent transition",
  tableAddRows:
    "absolute left-0 bottom-[-25px] h-5 w-[calc(100%-25px)] bg-muted hover:bg-accent transition",
  tableCell:
    "relative outline-hidden border border-border align-top text-start min-w-[75px] w-[75px] p-2",
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
    h1: "text-3xl font-semibold mb-2 text-foreground",
    h2: "text-2xl font-semibold mb-2 text-foreground",
    h3: "text-xl font-semibold mb-1 text-foreground",
    h4: "text-lg font-semibold mb-1 text-foreground",
    h5: "text-md font-semibold mb-0.5 text-foreground",
    h6: "text-sm font-semibold mb-0.5 text-foreground",
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
      before:border-muted-foreground
      before:rounded
      before:bg-white
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
      after:border-white
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
  paragraph: "m-0 relative text-foreground",
  placeholder:
    "text-muted top-4 left-3 absolute text-sm font-medium pointer-events-none inline-block",
  quote: `m-0 ml-5 border-l-4 border-gray-200 dark:border-gray-700 px-5 py-3 text-foreground`,
  rtl: "text-right",
  text: {
    code: `
      rounded-2xs
      text-muted-foreground
      bg-muted
      dark:bg-muted
      font-mono
      font-semibold
      overflow-x-auto
      py-0.5
      px-1.5
    `,
    bold: "font-bold text-foreground",
    hashtag: "editor-text-hashtag text-blue-600 dark:text-blue-400",
    italic: "italic text-foreground",
    overflowed: "editor-text-overflowed text-foreground",
    strikethrough: "line-through text-foreground",
    underline: "underline text-foreground",
    underlineStrikethrough: "underline line-through text-foreground",
  },
  layoutContainer: "grid gap-2 my-2",
  layoutItem: "border border-dashed border-muted p-2",
  // codeBlock: "bg-muted font-mono block px-2 pl-13 py-2 leading-[1.53] text-[13px] my-2 overflow-x-auto relative tab-size-[2]",
  codeGutter:
    "absolute bg-accent left-0 top-0 border-r border-muted px-2 text-muted-foreground whitespace-pre-wrap text-right min-w-[25px]",
} satisfies EditorThemeClasses;
