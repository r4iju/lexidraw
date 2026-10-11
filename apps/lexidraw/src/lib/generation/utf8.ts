/** Portable byte counting for JavaScriptCore, where TextEncoder is unavailable. */
export function utf8Bytes(text: string): number {
  let length = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}
