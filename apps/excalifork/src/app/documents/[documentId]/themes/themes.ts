import { EditorThemeClasses } from "lexical";
import "./theme-default.css"
import "./theme-dracula.css"

export const Theme = {
  code: "code",
  codeHighlight: {
    atrule: "tokenAttr",
    attr: "tokenAttr",
    boolean: "tokenProperty",
    builtin: "tokenSelector",
    cdata: "tokenComment",
    char: "tokenSelector",
    class: "tokenFunction",
    "class-name": "tokenFunction",
    comment: "tokenComment",
    constant: "tokenProperty",
    deleted: "tokenProperty",
    doctype: "tokenComment",
    entity: "tokenOperator",
    function: "tokenFunction",
    important: "tokenVariable",
    inserted: "tokenSelector",
    keyword: "tokenAttr",
    namespace: "tokenVariable",
    number: "tokenProperty",
    operator: "tokenOperator",
    prolog: "tokenComment",
    property: "tokenProperty",
    punctuation: "tokenPunctuation",
    regex: "tokenVariable",
    selector: "tokenSelector",
    string: "tokenSelector",
    symbol: "tokenProperty",
    tag: "tokenProperty",
    url: "tokenOperator",
    variable: "tokenVariable"
  },
  heading: {
    h1: 'text-2xl font-bold mb-2',
    h2: 'text-xl font-bold mb-2',
    h3: 'text-lg font-bold mb-1',
    h4: 'text-md font-bold mb-1',
    h5: 'text-sm font-bold mb-0.5',
    h6: 'text-xs font-bold mb-0.5',
  },
  image: 'editor-image',
  link: 'inline-flex items-center font-medium text-blue-600 dark:text-blue-500 hover:underline',
  list: {
    //.editor-listitem {
    // margin: 8px 32px 8px 32px;
    // }

    listitem: 'mx-8 my-2',
    nested: {
      listitem: 'list-none',
    },
    ol: 'list-decimal',
    ul: 'list-disc',
  },
  ltr: 'text-left',
  paragraph: 'm-0 mb-2 relative',
  placeholder: 'text-gray-500 dark:text-gray-400 top-4 left-3 absolute text-sm font-medium pointer-events-none inline-block',
  quote: `m-0 ml-5 border-l-4 border-gray-200 dark:border-gray-700 px-5 py-3`,
  rtl: 'text-right',
  text: {
    bold: 'font-bold',
    code: 'rounded-md bg-gray-100 dark:bg-gray-900 px-1 py-0.5 text-sm font-normal text-gray-900 dark:text-gray-100',
    hashtag: 'editor-text-hashtag',
    italic: 'font-italic',
    overflowed: 'editor-text-overflowed',
    strikethrough: 'line-through',
    underline: 'underline',
    underlineStrikethrough: 'underline line-through',
  },
} satisfies EditorThemeClasses;
