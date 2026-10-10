/** Scripts written without spaces between words. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * The word the cursor is in. The model is asked to repeat it before
 * continuing, so it writes the space between words itself instead of
 * guessing whether "the" is a word and "langu" is not.
 */
export function fragmentAt(before: string): string {
  const word = before.match(/\S*$/)?.[0] ?? "";
  return UNSPACED.test(word) ? "" : word;
}

/** Removes the repeated fragment from the start of the model's text. */
export function stripFragment(
  fragment: string,
): TransformStream<string, string> {
  let head = "";
  let decided = !fragment;
  return new TransformStream({
    transform(chunk, controller) {
      if (decided) return controller.enqueue(chunk);
      head += chunk;
      if (head.length < fragment.length && fragment.startsWith(head)) return;
      decided = true;
      controller.enqueue(
        head.startsWith(fragment) ? head.slice(fragment.length) : head,
      );
    },
    flush(controller) {
      // The model repeated at most the fragment, and so suggested nothing.
      if (!decided && !fragment.startsWith(head)) controller.enqueue(head);
    },
  });
}
