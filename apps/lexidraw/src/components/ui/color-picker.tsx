import { useEffect, useMemo, useState, useCallback } from "react";
import * as React from "react";
import { Label } from "./label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { cn } from "~/lib/utils";
import { RefreshCcwIcon } from "lucide-react";
import { Saturation as RcSaturation } from "../colorful/common/Saturation";
import { Hue as RcHue } from "../colorful/common/Hue";
import { HexColorInput as RcHexColorInput } from "../colorful/HexColorInput";
import { HsvaColor, HexColor } from "../colorful/types";
import { useConvertUtils } from "../colorful/utils/convert";

import "../colorful/css/styles.css";

const basicColors = [
  "#d0021b",
  "#f5a623",
  "#f8e71c",
  "#8b572a",
  "#7ed321",
  "#417505",
  "#bd10e0",
  "#9013fe",
  "#4a90e2",
  "#50e3c2",
  "#b8e986",
  "#000000",
  "#4a4a4a",
  "#9b9b9b",
  "#ffffff",
] as const;

const DEFAULT_PICKER_WIDTH = 214;

interface ColorPickerContentProps {
  color: string; // Expecting a hex string (e.g., #RRGGBB)
  onChange?: (newHexColor: string, skipHistoryStack: boolean) => void;
  className?: string;
  pickerWidth?: number;
}

interface ColorPickerButtonProps {
  disabled?: boolean;
  buttonAriaLabel?: string;
  title?: string;
  color: string; // Expecting a hex string
  Icon?: LucideIcon;
  onChange?: (newHexColor: string, skipHistoryStack: boolean) => void;
  className?: string;
}

export function ColorPickerContent({
  color,
  onChange,
  className,
  pickerWidth = DEFAULT_PICKER_WIDTH,
}: Readonly<ColorPickerContentProps>): React.JSX.Element {
  const { hexToHsva, hsvaToHex } = useConvertUtils();

  const [currentHsva, setCurrentHsva] = useState<HsvaColor>(() =>
    hexToHsva(color || "#000000"),
  );

  useEffect(() => {
    try {
      const newHsva = hexToHsva(color || "#000000");
      if (
        newHsva.h !== currentHsva.h ||
        newHsva.s !== currentHsva.s ||
        newHsva.v !== currentHsva.v ||
        newHsva.a !== currentHsva.a
      ) {
        setCurrentHsva(newHsva);
      }
    } catch (_e) {
      console.error("Error converting hex to hsva in useEffect:", _e);
      setCurrentHsva(hexToHsva("#000000"));
    }
  }, [
    color,
    currentHsva.h,
    currentHsva.s,
    currentHsva.v,
    currentHsva.a,
    hexToHsva,
  ]);

  const handleSaturationChange = useCallback(
    (newSaturationValue: { s: number; v: number }) => {
      const newHsvaColor = {
        ...currentHsva,
        s: newSaturationValue.s,
        v: newSaturationValue.v,
      };
      setCurrentHsva(newHsvaColor);
      onChange?.(hsvaToHex(newHsvaColor), true);
    },
    [currentHsva, hsvaToHex, onChange],
  );

  // Corrected: RcHue's onChange provides newHue as a number
  const handleHueChange = useCallback(
    (newHueValue: number) => {
      // newHueValue is a number
      const newHsvaColor = {
        ...currentHsva,
        h: newHueValue, // Assign the number directly
      };
      setCurrentHsva(newHsvaColor);
      onChange?.(hsvaToHex(newHsvaColor), true);
    },
    [currentHsva, hsvaToHex, onChange],
  );

  const handleHexInputChange = useCallback(
    (newHex: HexColor) => {
      const newHsvaColor = hexToHsva(newHex);
      setCurrentHsva(newHsvaColor);
      onChange?.(newHex, false);
    },
    [hexToHsva, onChange],
  );

  const currentHexForDisplay = useMemo(
    () => hsvaToHex(currentHsva),
    [currentHsva, hsvaToHex],
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-4 react-colorful-custom-wrapper",
        className,
      )}
      style={{ width: pickerWidth }}
    >
      <div className="relative" style={{ height: pickerWidth * 0.75 }}>
        <RcSaturation hsva={currentHsva} onChange={handleSaturationChange} />
      </div>

      <div className="relative" style={{ height: 16 }}>
        <RcHue
          hue={currentHsva.h}
          onChange={({ h: newHue }) => handleHueChange(newHue)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="rc-hex-input" className="text-sm">
          Hex
        </Label>
        <RcHexColorInput
          id="rc-hex-input"
          color={currentHexForDisplay}
          onChange={handleHexInputChange}
          className="w-full p-1 border rounded text-sm"
          prefixed
          alpha={false}
        />
      </div>

      <div className="flex flex-wrap gap-3 my-2">
        {basicColors.map((basicColor) => (
          <Button
            variant="ghost"
            className={cn(
              "outline size-6 rounded-full p-0 m-0 border-1 border-white hover:border-white hover:ring-2 hover:ring-ring",
              basicColor === currentHexForDisplay
                ? "ring-2 ring-ring ring-offset-1"
                : "",
            )}
            key={basicColor}
            style={{ backgroundColor: basicColor }}
            onClick={() => {
              const newHsvaFromSwatch = hexToHsva(basicColor);
              setCurrentHsva(newHsvaFromSwatch);
              onChange?.(basicColor, false);
            }}
            aria-label={`Select color ${basicColor}`}
          />
        ))}
      </div>

      <Button
        variant="outline"
        className="w-full flex items-center justify-center gap-2"
        onClick={() => {
          // Reset to transparent/no color
          onChange?.("", false);
        }}
      >
        <RefreshCcwIcon className="size-4" />
        Reset
      </Button>

      {/* Preview, maybe not needed */}
      {/* <div
        className="border border-foreground mt-3 w-full h-8 rounded-sm"
        style={{ backgroundColor: currentHexForDisplay }}
        aria-label={`Current selected color preview: ${currentHexForDisplay}`}
      /> */}
    </div>
  );
}

// ColorPickerButton remains the same as your last version, it seems fine.
// ... (ColorPickerButton code as provided in the prompt)
export function ColorPickerButton({
  buttonAriaLabel = "Choose color",
  title,
  disabled,
  color,
  onChange,
  Icon,
  className,
}: Readonly<ColorPickerButtonProps>): React.JSX.Element {
  const displayColor = useMemo(() => {
    if (!color || color === "") return "transparent";
    return /^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/i.test(color)
      ? color
      : "transparent";
  }, [color]);

  return (
    <Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              aria-label={buttonAriaLabel}
              variant="outline"
              className={cn("w-8 h-12 md:h-10 p-0.5", className)}
              disabled={disabled}
            >
              {Icon ? (
                <Icon className="size-4" />
              ) : (
                <div
                  className="w-6 h-6 rounded border border-gray-400"
                  style={{ backgroundColor: displayColor }}
                  aria-hidden="true"
                />
              )}
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[auto] w-auto p-0">
          <ColorPickerContent color={color} onChange={onChange} />
        </DropdownMenuContent>
      </DropdownMenu>
      {title && <TooltipContent>{title}</TooltipContent>}
    </Tooltip>
  );
}
