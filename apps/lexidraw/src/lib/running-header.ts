/**
 * The page rules that put the document's title at the top of every printed
 * sheet but the first, where the title already stands. The sheet number sits
 * in the stylesheet; only the title differs from one document to the next.
 */
export function runningHeaderCss(title: string): string {
  const text = title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    // A CSS escape reads as the character in the string, and keeps the
    // markup parser from seeing a closing tag.
    .replace(/</g, "\\3c ");
  return `@page{@top-left{content:"${text}"}}@page :first{@top-left{content:none}}`;
}
