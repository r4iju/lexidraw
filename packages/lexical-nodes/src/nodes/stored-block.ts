import { DecoratorBlockNode } from "@lexical/react/LexicalDecoratorBlockNode";
import { type ElementFormatType, withField } from "lexical";
import {
  checkedWithState,
  composedField,
  storedValue,
} from "../schema-values.js";

/**
 * DecoratorBlockNode's `format` as the embeds read it: as it was stored, and
 * through DecoratorBlockNode's schema where the node holds NodeState, which
 * they read through it.
 * @internal
 */
export const storedBlockFields = {
  format: withField(
    checkedWithState(
      composedField(DecoratorBlockNode, "format"),
      storedValue<ElementFormatType>(),
    ),
    { field: "__format" },
  ),
};
