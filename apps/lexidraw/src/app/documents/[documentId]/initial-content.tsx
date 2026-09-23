import { EMPTY_CONTENT } from "@packages/lexical-nodes";
import { useMemo } from "react";

export {
  DEFAULT_TEXT_NODE_ORIGINAL_KEY,
  EMPTY_CONTENT,
} from "@packages/lexical-nodes";

export const emptyContent = () => {
  return EMPTY_CONTENT;
};

export const useEmptyContent = () => {
  return useMemo(() => {
    return EMPTY_CONTENT;
  }, []);
};
