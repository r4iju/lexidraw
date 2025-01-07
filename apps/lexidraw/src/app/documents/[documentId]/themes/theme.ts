import { type EditorThemeClasses } from "lexical";
import "./playground-theme.css";

export const theme = {
  code: "rounded-md whitespace-pre block relative font-mono overflow-x-auto my-2 pl-8 py-4 bg-gray-100 dark:bg-gray-800 text-foreground",
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
  table: "PlaygroundEditorTheme__table",
  tableAddColumns: "PlaygroundEditorTheme__tableAddColumns",
  tableAddRows: "PlaygroundEditorTheme__tableAddRows",
  tableCell: "PlaygroundEditorTheme__tableCell",
  tableCellActionButton: "PlaygroundEditorTheme__tableCellActionButton",
  tableCellActionButtonContainer:
    "PlaygroundEditorTheme__tableCellActionButtonContainer",
  tableCellEditing: "PlaygroundEditorTheme__tableCellEditing",
  tableCellHeader: "PlaygroundEditorTheme__tableCellHeader",
  tableCellPrimarySelected: "PlaygroundEditorTheme__tableCellPrimarySelected",
  tableCellResizer: "PlaygroundEditorTheme__tableCellResizer",
  tableCellSelected: "PlaygroundEditorTheme__tableCellSelected",
  tableCellSortedIndicator: "PlaygroundEditorTheme__tableCellSortedIndicator",
  tableResizeRuler: "PlaygroundEditorTheme__tableCellResizeRuler",
  tableSelected: "PlaygroundEditorTheme__tableSelected",
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
    listitem: "mx-8",

    // Checklists:
    listitemUnchecked: `
      relative 
      p-0 
      ml-2 mr-2 
      pl-8 
      pr-8 
      list-none 
      outline-none
      before:absolute 
      before:left-0 
      before:top-1/2 
      before:-translate-y-1/2 
      before:w-5 
      before:h-5 
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
      ml-2 mr-2 
      pl-8 
      pr-8 
      list-none 
      outline-none
      line-through 
      text-muted-foreground 
      before:absolute 
      before:left-0 
      before:top-1/2 
      before:-translate-y-1/2 
      before:w-5 
      before:h-5 
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
    bold: "font-bold text-foreground",
    hashtag: "editor-text-hashtag text-blue-600 dark:text-blue-400",
    italic: "italic text-foreground",
    overflowed: "editor-text-overflowed text-foreground",
    strikethrough: "line-through text-foreground",
    underline: "underline text-foreground",
    underlineStrikethrough: "underline line-through text-foreground",
  },
} satisfies EditorThemeClasses;
