import type { Modifier } from "@dnd-kit/core";

/** Between the pointer and the ghost, and between the ghost and the screen's edge. */
const GAP = 12;
/** A finger is wider than a pointer's tip, and the hand below it hides more. */
const FINGER_GAP = 28;

type Size = { width: number; height: number };

function startOf(event: Event | null): { x: number; y: number } | null {
  if (!event) return null;
  const point =
    "touches" in event
      ? ((event as TouchEvent).touches[0] ??
        (event as TouchEvent).changedTouches?.[0])
      : (event as MouseEvent);
  return point ? { x: point.clientX, y: point.clientY } : null;
}

/**
 * Holds the drag ghost of `chip`'s size beside the pointer rather than where
 * the dragged card was, so what the pointer is over, and its highlight, stay
 * in sight: below and right of a mouse, above a finger, and flipped to the
 * other side where the screen runs out.
 */
export function besidePointer(chip: Size | null): Modifier {
  return ({ activatorEvent, activeNodeRect, transform, windowRect }) => {
    const start = startOf(activatorEvent);
    if (!chip || !start || !activeNodeRect || !windowRect) return transform;
    const x = start.x + transform.x;
    const y = start.y + transform.y;
    const touch = activatorEvent !== null && "touches" in activatorEvent;

    const right = x + GAP;
    const left =
      right + chip.width <= windowRect.width - GAP
        ? right
        : Math.max(GAP, x - GAP - chip.width);

    const gap = touch ? FINGER_GAP : GAP;
    const below = y + gap;
    const above = y - gap - chip.height;
    const top = touch
      ? above >= GAP
        ? above
        : below
      : below + chip.height <= windowRect.height - GAP
        ? below
        : above;

    return {
      ...transform,
      x: left - activeNodeRect.left,
      y: top - activeNodeRect.top,
    };
  };
}
