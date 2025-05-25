import React from "react";
import { Interactive, Interaction } from "./Interactive";
import { Pointer } from "./Pointer";
import { useConvertUtils } from "../utils/convert";
import { useClampUtils } from "../utils/clamp";
import { cn } from "~/lib/utils";
import { useRoundUtils } from "../utils/round";

interface Props {
  className?: string;
  hue: number;
  onChange: (newHue: { h: number }) => void;
}

const HueBase = ({ className, hue, onChange }: Props) => {
  const { round } = useRoundUtils();
  const { hsvaToHslString } = useConvertUtils();
  const { clamp } = useClampUtils();

  const handleMove = (interaction: Interaction) => {
    onChange({ h: 360 * interaction.left });
  };

  const handleKey = (offset: Interaction) => {
    // Hue measured in degrees of the color circle ranging from 0 to 360
    onChange({
      h: clamp(hue + offset.left * 360, 0, 360),
    });
  };

  return (
    <div
      className={cn("relative h-5", className)}
      style={{
        background: `linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)`,
      }}
    >
      <Interactive
        onMove={handleMove}
        onKey={handleKey}
        aria-label="Hue"
        aria-valuenow={round(hue)}
        aria-valuemax="360"
        aria-valuemin="0"
      >
        <Pointer
          className="z-[2]"
          left={hue / 360}
          color={hsvaToHslString({ h: hue, s: 100, v: 100, a: 1 })}
        />
      </Interactive>
    </div>
  );
};

export const Hue = React.memo(HueBase);
