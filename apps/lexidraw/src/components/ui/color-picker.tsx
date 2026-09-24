import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { Hue as RcHue } from "../colorful/common/Hue";
import { Saturation as RcSaturation } from "../colorful/common/Saturation";
import { HexColorInput as RcHexColorInput } from "../colorful/HexColorInput";
import type { HexColor, HsvaColor } from "../colorful/types";
import { useConvertUtils } from "../colorful/utils/convert";
import { Button } from "./button";
import { Label } from "./label";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

import "../colorful/css/styles.css";

export type ColorPreset = { label: string; value: string };

/**
 * Colours that follow the theme: stored as the variable with a fallback, so
 * the text keeps a colour wherever the document is shown without our CSS.
 */
function themed(kind: "text" | "highlight", presets: [string, string][]) {
  return presets.map(
    ([name, fallback]): ColorPreset => ({
      label: name[0]?.toUpperCase() + name.slice(1),
      value: `var(--doc-${kind}-${name}, ${fallback})`,
    }),
  );
}

export const TEXT_COLOUR_PRESETS = themed("text", [
  ["gray", "#6b6b73"],
  ["brown", "#8a5a3c"],
  ["orange", "#c4600e"],
  ["yellow", "#9a7400"],
  ["green", "#2e7d4f"],
  ["blue", "#2a6bd1"],
  ["purple", "#7a4fd1"],
  ["pink", "#c23d80"],
  ["red", "#c9362c"],
]);

export const HIGHLIGHT_PRESETS = themed("highlight", [
  ["gray", "#ececef"],
  ["brown", "#f1e6dd"],
  ["orange", "#fbe4d0"],
  ["yellow", "#fbf0c4"],
  ["green", "#dcf0e2"],
  ["blue", "#dde9fb"],
  ["purple", "#ebe2fb"],
  ["pink", "#f8e0ec"],
  ["red", "#fbdfdc"],
]);

const BASIC_COLOURS: ColorPreset[] = [
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
].map((value) => ({ label: value, value }));

const AUTOMATIC: ColorPreset = { label: "Automatic", value: "" };
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DEFAULT_PICKER_WIDTH = 214;

interface ColorPickerContentProps {
  /** A CSS colour, or empty for none: the theme decides. */
  color: string;
  onChange?: (color: string, skipHistoryStack: boolean) => void;
  presets?: ColorPreset[];
  className?: string;
  pickerWidth?: number;
}

export function ColorPickerContent({
  color,
  onChange,
  presets = BASIC_COLOURS,
  className,
  pickerWidth = DEFAULT_PICKER_WIDTH,
}: Readonly<ColorPickerContentProps>): React.JSX.Element {
  const swatches = [AUTOMATIC, ...presets];
  const current = swatches.find(
    (swatch) => swatch.value.toLowerCase() === color.toLowerCase(),
  );
  const [custom, setCustom] = useState(!current && HEX.test(color));

  const onSwatchKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    if (!step) return;
    const radios = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
    ];
    const index = radios.indexOf(event.target as HTMLElement);
    event.preventDefault();
    radios[(index + step + radios.length) % radios.length]?.focus();
  };

  return (
    <div
      className={cn("flex flex-col gap-3", className)}
      style={{ width: pickerWidth }}
    >
      <div
        role="radiogroup"
        aria-label="Colours"
        className="grid grid-cols-5 gap-2"
        onKeyDown={onSwatchKeyDown}
      >
        {swatches.map((swatch) => {
          const checked = swatch === (current ?? (color ? null : AUTOMATIC));
          return (
            // biome-ignore lint/a11y/useSemanticElements: a swatch, not a native radio
            <button
              type="button"
              role="radio"
              key={swatch.value || "automatic"}
              aria-checked={checked}
              aria-label={swatch.label}
              title={swatch.label}
              tabIndex={checked || (!current && swatch === AUTOMATIC) ? 0 : -1}
              onClick={() => onChange?.(swatch.value, false)}
              className={cn(
                "relative size-7 overflow-hidden rounded-full border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
                checked &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-popover",
              )}
              style={{ background: swatch.value || undefined }}
            >
              {swatch === AUTOMATIC && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 m-auto h-px w-[130%] -translate-x-[12%] -rotate-45 bg-destructive"
                />
              )}
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={custom}
        onClick={() => setCustom((open) => !open)}
        className="justify-start px-2"
      >
        Custom colour…
      </Button>
      {custom && (
        <CustomColour
          color={HEX.test(color) ? color : "#808080"}
          onChange={onChange}
          pickerWidth={pickerWidth}
        />
      )}
    </div>
  );
}

function CustomColour({
  color,
  onChange,
  pickerWidth,
}: {
  color: string;
  onChange?: (color: string, skipHistoryStack: boolean) => void;
  pickerWidth: number;
}) {
  const { hexToHsva, hsvaToHex } = useConvertUtils();
  const [hsva, setHsva] = useState<HsvaColor>(() => hexToHsva(color));
  const hexInputId = useId();
  const change = useCallback(
    (next: HsvaColor) => {
      setHsva(next);
      onChange?.(hsvaToHex(next), true);
    },
    [hsvaToHex, onChange],
  );
  const hex = useMemo(() => hsvaToHex(hsva), [hsva, hsvaToHex]);

  return (
    <div className="react-colorful-custom-wrapper flex flex-col gap-3">
      <div className="relative" style={{ height: pickerWidth * 0.75 }}>
        <RcSaturation
          hsva={hsva}
          onChange={({ s, v }) => change({ ...hsva, s, v })}
        />
      </div>
      <div className="relative" style={{ height: 16 }}>
        <RcHue hue={hsva.h} onChange={({ h }) => change({ ...hsva, h })} />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={hexInputId} className="text-sm">
          Hex
        </Label>
        <RcHexColorInput
          id={hexInputId}
          color={hex}
          onChange={(next: HexColor) => {
            setHsva(hexToHsva(next));
            onChange?.(next, false);
          }}
          className="w-full rounded border border-border p-1 text-sm"
          prefixed
          alpha={false}
        />
      </div>
    </div>
  );
}

interface ColorPickerButtonProps {
  /** Names the picker: its trigger, tooltip and heading. */
  title: string;
  disabled?: boolean;
  color: string;
  presets?: ColorPreset[];
  Icon?: LucideIcon;
  onChange?: (color: string, skipHistoryStack: boolean) => void;
  className?: string;
}

export function ColorPickerButton({
  title,
  disabled,
  color,
  presets,
  onChange,
  Icon,
  className,
}: Readonly<ColorPickerButtonProps>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <PopoverTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              type="button"
              aria-label={title}
              variant="ghost"
              className={cn(
                "relative size-8 shrink-0 p-0 pointer-coarse:size-11",
                className,
              )}
              disabled={disabled}
            >
              {Icon && <Icon />}
              <span
                aria-hidden="true"
                className="absolute inset-x-2 bottom-1 h-0.5 rounded-full"
                style={{ background: color || "currentColor" }}
              />
            </Button>
          </TooltipTrigger>
        </PopoverTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-auto p-3">
        <h3 className="mb-3 text-label font-medium">{title}</h3>
        <ColorPickerContent
          color={color}
          presets={presets}
          onChange={(value, skipHistoryStack) => {
            onChange?.(value, skipHistoryStack);
            if (!skipHistoryStack) setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
