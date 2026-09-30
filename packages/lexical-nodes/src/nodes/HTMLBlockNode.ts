import {
  DecoratorNode,
  nodeSchema,
  withField,
  type EditorConfig,
  type NodeKey,
} from "lexical";
import { SavedHTMLBlockSchema, type SavedHTMLBlock } from "../html-block.js";
import { rawValueOr } from "../schema-values.js";
import {
  storedFields,
  withStoredJSON,
  written,
  type ImportJSON,
} from "../stored-fields.js";
const { fields } = storedFields({
  type: written,
  version: written,
  block: withField(rawValueOr<unknown>(null), { field: "__block" }),
});
const schema = nodeSchema<HTMLBlockNode>()(fields);
export class HTMLBlockNode extends DecoratorNode<unknown> {
  declare static importJSON: ImportJSON<HTMLBlockNode>;
  __block: unknown;
  $config() {
    return this.config("html-block", { extends: DecoratorNode, json: schema });
  }
  constructor(block: unknown = null, key?: NodeKey) {
    super(key);
    this.__block = block;
  }
  getBlock(): SavedHTMLBlock | null {
    const parsed = SavedHTMLBlockSchema.safeParse(this.getLatest().__block);
    return parsed.success ? parsed.data : null;
  }
  isInline(): false {
    return false;
  }
  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.dataset.mediaType = "html-block";
    return div;
  }
  updateDOM(): false {
    return false;
  }
}
withStoredJSON(HTMLBlockNode);
