import { type RefObject, useEffect, useState } from "react";

/** Which sides of a sideways-scrolling element have more beyond them. */
export type HiddenEdges = "none" | "start" | "end" | "both";

/**
 * The sides of `ref`'s element that hide content, followed as it scrolls
 * and as it or its content resizes.
 */
export function useHiddenEdges(
  ref: RefObject<HTMLElement | null>,
): HiddenEdges {
  const [hidden, setHidden] = useState<HiddenEdges>("none");
  // External system: the element's layout and scroll position.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const start = element.scrollLeft > 1;
      const end =
        element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setHidden(start && end ? "both" : start ? "start" : end ? "end" : "none");
    };
    const resized = new ResizeObserver(measure);
    const watch = () => {
      resized.disconnect();
      resized.observe(element);
      for (const child of element.querySelectorAll("*")) resized.observe(child);
    };
    // The content is swapped as the diagram redraws.
    const swapped = new MutationObserver(() => {
      watch();
      measure();
    });
    swapped.observe(element, { childList: true, subtree: true });
    element.addEventListener("scroll", measure, { passive: true });
    watch();
    measure();
    return () => {
      resized.disconnect();
      swapped.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [ref]);
  return hidden;
}
