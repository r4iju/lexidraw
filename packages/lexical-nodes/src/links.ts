import {
  $createLinkNode,
  $isAutoLinkNode,
  createLinkMatcherWithRegExp,
  type LinkMatcher,
  TOGGLE_LINK_COMMAND,
} from "@lexical/link";
import { $isAtNodeEnd } from "@lexical/selection";
import {
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor,
  type RangeSelection,
  type TextNode,
} from "lexical";

/**
 * The document editor's namespace. A clipboard payload of Lexical nodes only
 * pastes as nodes into an editor of the namespace it was copied from.
 */
export const EDITOR_NAMESPACE = "Lexidraw";

const AUTOLINK_URL_REGEX =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)(?<![-.+():%])/;

const AUTOLINK_EMAIL_REGEX =
  /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/;

const URL_AUTOLINK_PREFIXES = ["http://", "https://", "www."] as const;
const EMAIL_AUTOLINK_DELIMITER = "@";

/** Every autolink matcher requires one of these substrings before it can match. */
export const AUTOLINK_REQUIRED_SUBSTRINGS = [
  ...URL_AUTOLINK_PREFIXES,
  EMAIL_AUTOLINK_DELIMITER,
] as const;

const matchUrl = createLinkMatcherWithRegExp(AUTOLINK_URL_REGEX, (text) =>
  text.startsWith("http") ? text : `https://${text}`,
);
const matchEmail = createLinkMatcherWithRegExp(
  AUTOLINK_EMAIL_REGEX,
  (text) => `mailto:${text}`,
);

/** The text the editor links as it's typed, and where each link goes. */
export const AUTOLINK_MATCHERS: LinkMatcher[] = [
  (text) =>
    URL_AUTOLINK_PREFIXES.some((prefix) => text.includes(prefix))
      ? matchUrl(text)
      : null,
  // Without @ the email regex backtracks through every candidate in long text.
  (text) => (text.includes(EMAIL_AUTOLINK_DELIMITER) ? matchEmail(text) : null),
];

const LINK_URL_REGEX =
  /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=+$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=+$,\w]+@)[A-Za-z0-9.-]+)((?:\/[+~%/.\w-_]*)?\??(?:[-+=&;%@.\w_]*)#?(?:[\w]*))?)/;

/**
 * Whether the editor links `url`, when asked to or when it's pasted over
 * selected text. "https://" is what a new link starts as.
 */
export function validateUrl(url: string): boolean {
  return url === "https://" || LINK_URL_REGEX.test(url);
}

/** The protocols a link opens with. The link editor saves any other as about:blank. */
export const SUPPORTED_URL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "sms:",
  "tel:",
]);

/**
 * `url` as the link editor saves and opens it: as `URL` writes it, or
 * about:blank where its protocol isn't supported. A URL that `URL` can't
 * parse stays as it is.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return SUPPORTED_URL_PROTOCOLS.has(parsed.protocol)
      ? parsed.toString()
      : "about:blank";
  } catch {
    return url;
  }
}

/** The node the link editor reads a selection's link from. */
export function $getSelectedNode(
  selection: RangeSelection,
): TextNode | ElementNode {
  const { anchor, focus } = selection;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  if (anchorNode === focusNode) return anchorNode;
  if (selection.isBackward()) {
    return $isAtNodeEnd(focus) ? anchorNode : focusNode;
  }
  return $isAtNodeEnd(anchor) ? anchorNode : focusNode;
}

/**
 * The link editor's save: the selection's link takes `url`, sanitized, and
 * an autolink becomes a link, which typing no longer relinks.
 */
export function saveLink(editor: LexicalEditor, url: string): void {
  editor.dispatchCommand(TOGGLE_LINK_COMMAND, sanitizeUrl(url));
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const parent = $getSelectedNode(selection).getParent();
    if ($isAutoLinkNode(parent)) {
      const link = $createLinkNode(parent.getURL(), {
        rel: parent.__rel,
        target: parent.__target,
        title: parent.__title,
      });
      parent.replace(link, true);
    }
  });
}
