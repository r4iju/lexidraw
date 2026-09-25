/** How the app scrolls for the reader: smoothly, or at once if they asked for less motion. */
export function scrollMotion(): ScrollBehavior {
  return matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "instant"
    : "smooth";
}
