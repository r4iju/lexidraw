import { createLinkMatcherWithRegExp, type LinkMatcher } from "@lexical/link";

/**
 * The document editor's namespace. A clipboard payload of Lexical nodes only
 * pastes as nodes into an editor of the namespace it was copied from.
 */
export const EDITOR_NAMESPACE = "Lexidraw";

export const AUTOLINK_URL_REGEX =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)(?<![-.+():%])/;

export const AUTOLINK_EMAIL_REGEX =
  /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/;

/** The text the editor links as it's typed, and where each link goes. */
export const AUTOLINK_MATCHERS: LinkMatcher[] = [
  createLinkMatcherWithRegExp(AUTOLINK_URL_REGEX, (text) =>
    text.startsWith("http") ? text : `https://${text}`,
  ),
  createLinkMatcherWithRegExp(AUTOLINK_EMAIL_REGEX, (text) => `mailto:${text}`),
];

export const LINK_URL_REGEX =
  /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=+$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=+$,\w]+@)[A-Za-z0-9.-]+)((?:\/[+~%/.\w-_]*)?\??(?:[-+=&;%@.\w_]*)#?(?:[\w]*))?)/;

/**
 * Whether the editor links `url`, when asked to or when it's pasted over
 * selected text. "https://" is what a new link starts as.
 */
export function validateUrl(url: string): boolean {
  return url === "https://" || LINK_URL_REGEX.test(url);
}
