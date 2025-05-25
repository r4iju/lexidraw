import type { JSX } from "react";
import { Interactive, Interaction } from "./Interactive";
import { Pointer } from "./Pointer";
import { useConvertUtils } from "../utils/convert";
import { useClampUtils } from "../utils/clamp";
import { HsvaColor } from "../types";
import { cn } from "~/lib/utils";
import { useRoundUtils } from "../utils/round";

interface Props {
  className?: string;
  hsva: HsvaColor;
  onChange: (newAlpha: { a: number }) => void;
}

const PointerBackground = ({ className }: { className?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill-opacity=".05"
      className={className}
    >
      <rect x="8" width="8" height="8" />
      <rect y="8" width="8" height="8" />
    </svg>
  );
};

export const Alpha = ({ className, hsva, onChange }: Props): JSX.Element => {
  const { hsvaToHslaString } = useConvertUtils();
  const { clamp } = useClampUtils();
  const { round } = useRoundUtils();

  const handleMove = (interaction: Interaction) => {
    onChange({ a: interaction.left });
  };

  const handleKey = (offset: Interaction) => {
    // Alpha always fit into [0, 1] range
    onChange({ a: clamp(hsva.a + offset.left) });
  };

  // We use `Object.assign` instead of the spread operator
  // to prevent adding the polyfill (about 150 bytes gzipped)
  const colorFrom = hsvaToHslaString(Object.assign({}, hsva, { a: 0 }));
  const colorTo = hsvaToHslaString(Object.assign({}, hsva, { a: 1 }));

  const ariaValue = round(hsva.a * 100);

  return (
    <div className={cn("relative h-5", className)}>
      <div
        className="absolute left-0 top-0 right-0 bottom-0 pointer-events-none border-radius-inherit"
        style={{
          backgroundImage: `linear-gradient(90deg, ${colorFrom}, ${colorTo})`,
          content: "",
        }}
      />
      <Interactive
        onMove={handleMove}
        onKey={handleKey}
        aria-label="Alpha"
        aria-valuetext={`${ariaValue}%`}
        aria-valuenow={ariaValue}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <Pointer
          className="z-[2]"
          left={hsva.a}
          color={hsvaToHslaString(hsva)}
        />
        <PointerBackground className="z-[1]" />
      </Interactive>
    </div>
  );
};
