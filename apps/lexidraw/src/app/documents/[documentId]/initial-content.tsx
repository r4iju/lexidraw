import { useMemo } from "react";
import type { KeyedSerializedEditorState } from "./types";

export const DEFAULT_TEXT_NODE_ORIGINAL_KEY = "initial-text-content-node"; // Or any other unique static key

export const EMPTY_CONTENT = {
  root: {
    children: [
      {
        key: "1",
        type: "paragraph",
        version: 1,
        direction: "ltr",
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "",
            type: "text",
            version: 1,
            key: DEFAULT_TEXT_NODE_ORIGINAL_KEY,
          },
        ],
      },
    ],

    direction: "ltr",
    format: "",
    indent: 0,
    type: "root",
    version: 1,
    key: "root",
  },
} satisfies KeyedSerializedEditorState;

export const emptyContent = () => {
  return EMPTY_CONTENT;
};

export const useEmptyContent = () => {
  return useMemo(() => {
    return EMPTY_CONTENT;
  }, []);
};
