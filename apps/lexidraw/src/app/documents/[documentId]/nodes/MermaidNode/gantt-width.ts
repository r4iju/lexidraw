/** The room between two axis labels: about 0.8em at their 10px. */
const GAP = 8;

/**
 * The width a gantt drawn at `width` needs for its axis labels not to
 * overlap: Mermaid picks about ten date ticks whatever the width, so a
 * narrow column crowds them. `sides` is the room Mermaid keeps left and
 * right of the timeline; only the timeline stretches.
 */
export function ganttWidth(
  svg: Element,
  width: number,
  sides: number,
  measure: (label: string) => number,
) {
  let needed = 1;
  for (const axis of svg.querySelectorAll(".grid")) {
    const ticks = [...axis.querySelectorAll(":scope > .tick")].map((tick) => ({
      x: Number(
        /translate\(\s*([-\d.]+)/.exec(
          tick.getAttribute("transform") ?? "",
        )?.[1],
      ),
      label: tick.textContent?.trim() ?? "",
    }));
    for (const [i, tick] of ticks.entries()) {
      const next = ticks[i + 1];
      if (!next || !(next.x > tick.x)) continue;
      // Labels are centred on their ticks.
      const room = (measure(tick.label) + measure(next.label)) / 2 + GAP;
      needed = Math.max(needed, room / (next.x - tick.x));
    }
  }
  return needed > 1 ? Math.ceil(sides + (width - sides) * needed) : width;
}
