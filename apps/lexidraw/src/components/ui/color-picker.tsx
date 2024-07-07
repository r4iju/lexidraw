import { calculateZoomLevel } from "@lexical/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import * as React from "react";

import { Input } from "./input";
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

let skipAddingToHistoryStack = false;

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
];

const WIDTH = 214;
const HEIGHT = 150;

interface ColorPickerContentProps {
  color: string;
  onChange?: (value: string, skipHistoryStack: boolean) => void;
  className?: string;
}

interface ColorPickerButtonProps {
  disabled?: boolean;
  buttonAriaLabel?: string;
  title?: string;
  color: string;
  Icon?: LucideIcon;
  onChange?: (value: string, skipHistoryStack: boolean) => void;
}

export function ColorPickerContent({
  color,
  onChange,
  className,
}: Readonly<ColorPickerContentProps>): JSX.Element {
  const [selfColor, setSelfColor] = useState(transformColor("hex", color));
  const [inputColor, setInputColor] = useState(color);
  const innerDivRef = useRef(null);

  const saturationPosition = useMemo(
    () => ({
      x: (selfColor.hsv.s / 100) * WIDTH,
      y: ((100 - selfColor.hsv.v) / 100) * HEIGHT,
    }),
    [selfColor.hsv.s, selfColor.hsv.v],
  );

  const huePosition = useMemo(
    () => ({
      x: (selfColor.hsv.h / 360) * WIDTH,
    }),
    [selfColor.hsv],
  );

  const onSetHex = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    setInputColor(hex);
    if (/^#[0-9A-Fa-f]{6}$/i.test(hex)) {
      const newColor = transformColor("hex", hex);
      setSelfColor(newColor);
    }
  };

  const onMoveSaturation = ({ x, y }: Position) => {
    const newHsv = {
      ...selfColor.hsv,
      s: (x / WIDTH) * 100,
      v: 100 - (y / HEIGHT) * 100,
    };
    const newColor = transformColor("hsv", newHsv);
    setSelfColor(newColor);
    setInputColor(newColor.hex);
  };

  const onMoveHue = ({ x }: Position) => {
    const newHsv = { ...selfColor.hsv, h: (x / WIDTH) * 360 };
    const newColor = transformColor("hsv", newHsv);

    setSelfColor(newColor);
    setInputColor(newColor.hex);
  };

  useEffect(() => {
    if (innerDivRef.current !== null && onChange) {
      onChange(selfColor.hex, skipAddingToHistoryStack);
      setInputColor(selfColor.hex);
    }
  }, [selfColor, onChange]);

  useEffect(() => {
    if (color === undefined) {
      return;
    }
    const newColor = transformColor("hex", color);
    setSelfColor(newColor);
    setInputColor(newColor.hex);
  }, [color]);

  return (
    <div
      className={cn("flex flex-col gap-2 p-5 min-w-fit", className)}
      style={{ width: WIDTH }}
      ref={innerDivRef}
    >
      <Label htmlFor="hex">Hex</Label>
      <Input id="hex" onChange={onSetHex} value={inputColor} />
      <div className="flex flex-wrap gap-2.5 m-0 p-0">
        {basicColors.map((basicColor) => (
          <Button
            variant="default"
            className={cn(
              "outline size-5 rounded-full p-0 m-0",
              basicColor === selfColor.hex
                ? " ring-4 ring-muted-foreground"
                : "",
            )}
            key={basicColor}
            style={{ backgroundColor: basicColor }}
            onClick={() => {
              setInputColor(basicColor);
              setSelfColor(transformColor("hex", basicColor));
            }}
          />
        ))}
      </div>
      <MoveWrapper
        className="color-picker-saturation relative select-none mt-3 h-[150px] min-w-[250px] rounded-sm border-[1px] border-foreground"
        style={{
          backgroundColor: `hsl(${selfColor.hsv.h}, 100%, 50%)`,
          backgroundImage: `linear-gradient(transparent, black), linear-gradient(to right, white, transparent)`,
        }}
        onChange={onMoveSaturation}
      >
        <div
          className="absolute size-5 border-2 border-foreground rounded-full cursor-pointer shadow-md translate-x-[-10px] translate-y-[-10px]"
          style={{
            backgroundColor: selfColor.hex,
            left: saturationPosition.x,
            top: saturationPosition.y,
          }}
        />
      </MoveWrapper>
      <MoveWrapper
        className="w-full relative mt-4 h-4 select-none rounded-sm min-w-[250px]"
        onChange={onMoveHue}
        style={{
          backgroundImage: `linear-gradient(
            to right,
            rgb(255, 0, 0),
            rgb(255, 255, 0),
            rgb(0, 255, 0),
            rgb(0, 255, 255),
            rgb(0, 0, 255),
            rgb(255, 0, 255),
            rgb(255, 0, 0)
          )`,
        }}
      >
        <div
          className="absolute size-5 border-2 border-foreground rounded-full cursor-pointer shadow-md translate-x-[-10px] translate-y-[-4px]"
          style={{
            backgroundColor: `hsl(${selfColor.hsv.h}, 100%, 50%)`,
            left: huePosition.x,
          }}
        />
      </MoveWrapper>
      <div
        className=" border-[1px] border-foreground mt-4 w-full h-5 rounded-sm"
        style={{ backgroundColor: selfColor.hex }}
      />
    </div>
  );
}

export function ColorPickerButton({
  buttonAriaLabel,
  title,
  disabled,
  color,
  onChange,
  Icon,
}: Readonly<ColorPickerButtonProps>): JSX.Element {
  const [currentColor, setCurrentColor] = useState(color);

  const handleChange = (newColor: string, skipHistoryStack: boolean) => {
    setCurrentColor(newColor);
    if (onChange) {
      onChange(newColor, skipHistoryStack);
    }
  };

  return (
    <Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              aria-label={buttonAriaLabel}
              variant="outline"
              className="w-8 h-10 p-0.5"
              disabled={disabled}
            >
              {Icon && <Icon className="size-4" />}
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[300px]">
          <ColorPickerContent color={currentColor} onChange={handleChange} />
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export interface Position {
  x: number;
  y: number;
}

interface MoveWrapperProps {
  className?: string;
  style?: React.CSSProperties;
  onChange: (position: Position) => void;
  children: JSX.Element;
}

function MoveWrapper({
  className,
  style,
  onChange,
  children,
}: MoveWrapperProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);

  const move = (e: MouseEvent | React.MouseEvent): void => {
    if (divRef.current) {
      const { current: div } = divRef;
      const { width, height, left, top } = div.getBoundingClientRect();
      const zoom = calculateZoomLevel(div) / window.devicePixelRatio;
      const x = clamp((e.clientX - left) / zoom, width, 0);
      const y = clamp((e.clientY - top) / zoom, height, 0);

      onChange({ x, y });
    }
  };

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) {
      return;
    }

    move(e);

    const onMouseMove = (_e: MouseEvent): void => {
      draggedRef.current = true;
      skipAddingToHistoryStack = true;
      move(_e);
    };

    const onMouseUp = (_e: MouseEvent): void => {
      if (draggedRef.current) {
        skipAddingToHistoryStack = false;
      }

      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      move(_e);
      draggedRef.current = false;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      ref={divRef}
      className={className}
      style={style}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>
  );
}

function clamp(value: number, max: number, min: number) {
  return value > max ? max : value < min ? min : value;
}

interface RGB {
  b: number;
  g: number;
  r: number;
}
interface HSV {
  h: number;
  s: number;
  v: number;
}
interface Color {
  hex: string;
  hsv: HSV;
  rgb: RGB;
}

export function toHex(value: string): string {
  if (!value.startsWith("#")) {
    const ctx = document.createElement("canvas").getContext("2d");

    if (!ctx) {
      throw new Error("2d context not supported or canvas already initialized");
    }

    ctx.fillStyle = value;

    return ctx.fillStyle;
  } else if (value.length === 4 || value.length === 5) {
    value = value
      .split("")
      .map((v, i) => (i ? v + v : "#"))
      .join("");

    return value;
  } else if (value.length === 7 || value.length === 9) {
    return value;
  }

  return "#000000";
}

function hex2rgb(hex: string): RGB {
  const rbgArr = (
    hex
      .replace(
        /^#?([a-f\d])([a-f\d])([a-f\d])$/i,
        (m, r, g, b) => "#" + r + r + g + g + b + b,
      )
      .substring(1)
      .match(/.{2}/g) || []
  ).map((x) => parseInt(x, 16));

  return {
    b: rbgArr[2] as number,
    g: rbgArr[1] as number,
    r: rbgArr[0] as number,
  };
}

function rgb2hsv({ r, g, b }: RGB): HSV {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);

  const h = d
    ? (max === r
        ? (g - b) / d + (g < b ? 6 : 0)
        : max === g
          ? 2 + (b - r) / d
          : 4 + (r - g) / d) * 60
    : 0;
  const s = max ? (d / max) * 100 : 0;
  const v = max * 100;

  return { h, s, v };
}

function hsv2rgb({ h, s, v }: HSV): RGB {
  s /= 100;
  v /= 100;

  const i = ~~(h / 60);
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const index = i % 6;

  const r = Math.round(([v, q, p, p, t, v][index] as number) * 255);
  const g = Math.round(([t, v, v, q, p, p][index] as number) * 255);
  const b = Math.round(([p, p, t, v, v, q][index] as number) * 255);

  return { b, g, r };
}

function rgb2hex({ b, g, r }: RGB): string {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function transformColor<M extends keyof Color, C extends Color[M]>(
  format: M,
  color: C,
): Color {
  let hex: Color["hex"] = toHex("#121212");
  let rgb: Color["rgb"] = hex2rgb(hex);
  let hsv: Color["hsv"] = rgb2hsv(rgb);

  if (format === "hex") {
    const value = color as Color["hex"];

    hex = toHex(value);
    rgb = hex2rgb(hex);
    hsv = rgb2hsv(rgb);
  } else if (format === "rgb") {
    const value = color as Color["rgb"];

    rgb = value;
    hex = rgb2hex(rgb);
    hsv = rgb2hsv(rgb);
  } else if (format === "hsv") {
    const value = color as Color["hsv"];

    hsv = value;
    rgb = hsv2rgb(hsv);
    hex = rgb2hex(rgb);
  }

  return { hex, hsv, rgb };
}
