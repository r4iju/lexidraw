import React from "react";
import { cn } from "~/lib/utils";
import { Interactive, type Interaction } from "./Interactive";
import { Pointer } from "./Pointer";
import type { HsvaColor } from "../types";
import { useConvertUtils } from "../utils/convert";
import { useClampUtils } from "../utils/clamp";
import { useRoundUtils } from "../utils/round";

interface Props {
  hsva: HsvaColor;
  onChange: (newColor: { s: number; v: number }) => void;
  className?: string;
}

const SaturationBase = ({ hsva, onChange, className }: Props) => {
  const { round } = useRoundUtils();
  const { clamp } = useClampUtils();
  const handleMove = (interaction: Interaction) => {
    onChange({
      s: interaction.left * 100,
      v: 100 - interaction.top * 100,
    });
  };

  const handleKey = (offset: Interaction) => {
    // Saturation and brightness always fit into [0, 100] range
    onChange({
      s: clamp(hsva.s + offset.left * 100, 0, 100),
      v: clamp(hsva.v - offset.top * 100, 0, 100),
    });
  };

  const { hsvaToHslString } = useConvertUtils();

  const pureHueBackgroundColor = hsvaToHslString({
    h: hsva.h,
    s: 100,
    v: 100,
    a: 1,
  });
  const layeredGradients = `linear-gradient(to top, black, rgba(0,0,0,0)), linear-gradient(to right, white, rgba(255,255,255,0))`;

  // background-image:
  //   linear-gradient(to top, #000, rgba(0, 0, 0, 0)),
  //   linear-gradient(to right, #fff, rgba(255, 255, 255, 0));

  return (
    <div
      className={cn(
        "relative size-full rounded-t-md",
        "border-b-3 border-border-border",
        "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]",
        className,
      )}
      style={{
        backgroundColor: pureHueBackgroundColor, // Base layer
        backgroundImage: layeredGradients, // Gradient layers on top of backgroundColor
      }}
    >
      <Interactive
        onMove={handleMove}
        onKey={handleKey}
        aria-label="Color"
        aria-valuetext={`Saturation ${round(hsva.s)}%, Brightness ${round(hsva.v)}%`}
      >
        <Pointer
          className="z-[2]"
          // Using rounded-[inherit] to pick up the parent's rounded-t-[8px].
          // If this doesn't work perfectly, explicitly use rounded-t-[8px].
          top={1 - hsva.v / 100}
          left={hsva.s / 100}
          color={hsvaToHslString(hsva)}
        />
      </Interactive>
    </div>
  );
};

export const Saturation = React.memo(SaturationBase);
