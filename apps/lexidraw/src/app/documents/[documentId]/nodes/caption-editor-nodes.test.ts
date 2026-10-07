/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { HashtagNode } from "@lexical/hashtag";
import { LinkNode } from "@lexical/link";
import { EmojiNode, KeywordNode, MentionNode } from "@packages/lexical-nodes";
import {
  $create,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { DOCUMENT_NODES } from "./document-nodes";
import { ImageNode } from "./ImageNode/ImageNode";
import { InlineImageNode } from "./InlineImageNode/InlineImageNode";
import { StickyNode } from "./StickyNode";
import { VideoNode } from "./VideoNode/VideoNode";

/**
 * The nodes each plugin a caption can mount needs registered; a plugin
 * missing them throws when the caption shows.
 */
const PLUGIN_NODES: Record<string, Klass<LexicalNode>[]> = {
  PlainTextPlugin: [],
  HistoryPlugin: [],
  TreeViewPlugin: [],
  LinkPlugin: [LinkNode],
  MentionsPlugin: [MentionNode],
  EmojisPlugin: [EmojiNode],
  HashtagPlugin: [HashtagNode],
  KeywordsPlugin: [KeywordNode],
};

const CAPTIONS = [
  {
    node: ImageNode,
    component: "ImageNode/ImageComponent.tsx",
    wrapper: "ImageCaption",
  },
  {
    node: InlineImageNode,
    component: "InlineImageNode/InlineImageComponent.tsx",
    wrapper: "ImageCaption",
  },
  {
    node: VideoNode,
    component: "VideoNode/VideoComponent.tsx",
    wrapper: "ImageCaption",
  },
  {
    node: StickyNode,
    component: "StickyComponent.tsx",
    wrapper: "LexicalNestedComposer",
  },
] as const;

/** The plugins `component` mounts inside its caption editor's wrapper. */
async function mountedPlugins(component: string, wrapper: string) {
  const source = await Bun.file(
    new URL(`./${component}`, import.meta.url),
  ).text();
  const start = source.indexOf(`<${wrapper}`);
  const end = source.indexOf(`</${wrapper}>`, start);
  if (start < 0 || end < 0) throw new Error(`${component} has no <${wrapper}>`);
  return [...source.slice(start, end).matchAll(/<(\w+Plugin)\b/g)].map(
    (match) => match[1] as string,
  );
}

/**
 * The caption editor `klass` makes, with the nodes it has once mounted: a
 * caption made without nodes of its own takes the document editor's, as
 * LexicalNestedComposer gives it.
 */
function captionOf(klass: Klass<LexicalNode>): LexicalEditor {
  const editor = createHeadlessEditor({ nodes: [klass] });
  let caption: LexicalEditor | undefined;
  editor.update(
    () => {
      caption = ($create(klass) as LexicalNode & { __caption: LexicalEditor })
        .__caption;
    },
    { discrete: true },
  );
  if (!caption) throw new Error(`${klass.name} made no caption editor`);
  if (!caption._createEditorArgs?.nodes) {
    caption._nodes = createHeadlessEditor({ nodes: DOCUMENT_NODES })._nodes;
  }
  return caption;
}

for (const { node, component, wrapper } of CAPTIONS) {
  test(`the ${node.getType()} caption registers every node its mounted plugins need`, async () => {
    const plugins = await mountedPlugins(component, wrapper);
    expect(plugins.length).toBeGreaterThan(0);
    const unknown = plugins.filter((plugin) => !(plugin in PLUGIN_NODES));
    expect(unknown).toEqual([]);
    const caption = captionOf(node);
    const missing = plugins.flatMap((plugin) =>
      (PLUGIN_NODES[plugin] ?? [])
        .filter((needed) => !caption.hasNodes([needed]))
        .map((needed) => `${plugin} needs ${needed.getType()}`),
    );
    expect(missing).toEqual([]);
  });
}
