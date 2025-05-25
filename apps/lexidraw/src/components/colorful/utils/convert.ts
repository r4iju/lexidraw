import { useCallback, useMemo } from "react";
import { useRoundUtils } from "./round";
import {
  RgbaColor,
  RgbColor,
  HslaColor,
  HslColor,
  HsvaColor,
  HsvColor,
} from "../types";

export const useConvertUtils = () => {
  const { round } = useRoundUtils();

  /**
   * Valid CSS <angle> units.
   * https://developer.mozilla.org/en-US/docs/Web/CSS/angle
   */
  const angleUnits: Record<string, number> = useMemo(
    () => ({
      grad: 360 / 400,
      turn: 360,
      rad: 360 / (Math.PI * 2),
    }),
    [],
  );

  const rgbaToHsva = useCallback(
    ({ r, g, b, a }: RgbaColor): HsvaColor => {
      const max = Math.max(r, g, b);
      const delta = max - Math.min(r, g, b);

      // prettier-ignore
      const hh = delta
    ? max === r
      ? (g - b) / delta
      : max === g
        ? 2 + (b - r) / delta
        : 4 + (r - g) / delta
    : 0;

      return {
        h: round(60 * (hh < 0 ? hh + 6 : hh)),
        s: round(max ? (delta / max) * 100 : 0),
        v: round((max / 255) * 100),
        a,
      };
    },
    [round],
  );

  const hexToRgba = useCallback(
    (hex: string): RgbaColor => {
      if (hex[0] === "#") hex = hex.substring(1);

      if (hex.length < 6) {
        return {
          r: parseInt((hex[0] as string) + hex[0], 16),
          g: parseInt((hex[1] as string) + hex[1], 16),
          b: parseInt((hex[2] as string) + hex[2], 16),
          a:
            hex.length === 4
              ? round(parseInt((hex[3] as string) + hex[3], 16) / 255, 2)
              : 1,
        };
      }

      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        a:
          hex.length === 8
            ? round(parseInt(hex.substring(6, 8), 16) / 255, 2)
            : 1,
      };
    },
    [round],
  );

  const hexToHsva = useCallback(
    (hex: string): HsvaColor => rgbaToHsva(hexToRgba(hex)),
    [rgbaToHsva, hexToRgba],
  );

  const parseHue = useCallback(
    (value: string, unit = "deg"): number => {
      return Number(value) * (angleUnits[unit] || 1);
    },
    [angleUnits],
  );

  const hslaToHsva = useCallback(({ h, s, l, a }: HslaColor): HsvaColor => {
    s *= (l < 50 ? l : 100 - l) / 100;

    return {
      h: h,
      s: s > 0 ? ((2 * s) / (l + s)) * 100 : 0,
      v: l + s,
      a,
    };
  }, []);

  const hslaStringToHsva = useCallback(
    (hslString: string): HsvaColor => {
      const matcher =
        /hsla?\(?\s*(-?\d*\.?\d+)(deg|rad|grad|turn)?[,\s]+(-?\d*\.?\d+)%?[,\s]+(-?\d*\.?\d+)%?,?\s*[/\s]*(-?\d*\.?\d+)?(%)?\s*\)?/i;
      const match = matcher.exec(hslString);

      if (!match) return { h: 0, s: 0, v: 0, a: 1 };

      return hslaToHsva({
        h: parseHue(match[1] as string, match[2] as string),
        s: Number(match[3]),
        l: Number(match[4]),
        a: match[5] === undefined ? 1 : Number(match[5]) / (match[6] ? 100 : 1),
      });
    },
    [parseHue, hslaToHsva],
  );

  const hslStringToHsva = hslaStringToHsva;

  const format = useCallback((number: number) => {
    const hex = number.toString(16);
    return hex.length < 2 ? "0" + hex : hex;
  }, []);

  const hsvaToRgba = useCallback(
    ({ h, s, v, a }: HsvaColor): RgbaColor => {
      h = (h / 360) * 6;
      s = s / 100;
      v = v / 100;

      const hh = Math.floor(h),
        b_val = v * (1 - s),
        c_val = v * (1 - (h - hh) * s),
        d_val = v * (1 - (1 - h + hh) * s),
        hueSegment = hh % 6;

      return {
        r: round(
          ([v, c_val, b_val, b_val, d_val, v][hueSegment] as number) * 255,
        ),
        g: round(
          ([d_val, v, v, c_val, b_val, b_val][hueSegment] as number) * 255,
        ),
        b: round(
          ([b_val, b_val, d_val, v, v, c_val][hueSegment] as number) * 255,
        ),
        a: round(a, 2),
      };
    },
    [round],
  );

  const rgbaToHex = useCallback(
    ({ r, g, b, a }: RgbaColor): string => {
      const alphaHex = a < 1 ? format(round(a * 255)) : "";
      return "#" + format(r) + format(g) + format(b) + alphaHex;
    },
    [format, round],
  );

  const hsvaToHex = useCallback(
    (hsva: HsvaColor): string => rgbaToHex(hsvaToRgba(hsva)),
    [rgbaToHex, hsvaToRgba],
  );

  const hsvaToHsla = useCallback(
    ({ h, s, v, a }: HsvaColor): HslaColor => {
      const hh = ((200 - s) * v) / 100;

      return {
        h: round(h),
        s: round(
          hh > 0 && hh < 200
            ? ((s * v) / 100 / (hh <= 100 ? hh : 200 - hh)) * 100
            : 0,
        ),
        l: round(hh / 2),
        a: round(a, 2),
      };
    },
    [round],
  );

  const hsvaToHslString = useCallback(
    (hsva: HsvaColor): string => {
      const { h, s, l } = hsvaToHsla(hsva);
      return `hsl(${h}, ${s}%, ${l}%)`;
    },
    [hsvaToHsla],
  );

  const roundHsva = useCallback(
    (hsva: HsvaColor): HsvaColor => ({
      h: round(hsva.h),
      s: round(hsva.s),
      v: round(hsva.v),
      a: round(hsva.a, 2),
    }),
    [round],
  );

  const hsvaToHsvString = useCallback(
    (hsva: HsvaColor): string => {
      const { h, s, v } = roundHsva(hsva);
      return `hsv(${h}, ${s}%, ${v}%)`;
    },
    [roundHsva],
  );

  const hsvaToHsvaString = useCallback(
    (hsva: HsvaColor): string => {
      const { h, s, v, a } = roundHsva(hsva);
      return `hsva(${h}, ${s}%, ${v}%, ${a})`;
    },
    [roundHsva],
  );

  const hsvaToHslaString = useCallback(
    (hsva: HsvaColor): string => {
      const { h, s, l, a } = hsvaToHsla(hsva);
      return `hsla(${h}, ${s}%, ${l}%, ${a})`;
    },
    [hsvaToHsla],
  );

  const hsvaToRgbString = useCallback(
    (hsva: HsvaColor): string => {
      const { r, g, b } = hsvaToRgba(hsva);
      return `rgb(${r}, ${g}, ${b})`;
    },
    [hsvaToRgba],
  );

  const hsvaToRgbaString = useCallback(
    (hsva: HsvaColor): string => {
      const { r, g, b, a } = hsvaToRgba(hsva);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    },
    [hsvaToRgba],
  );

  const hsvaStringToHsva = useCallback(
    (hsvString: string): HsvaColor => {
      const matcher =
        /hsva?\(?\s*(-?\d*\.?\d+)(deg|rad|grad|turn)?[,\s]+(-?\d*\.?\d+)%?[,\s]+(-?\d*\.?\d+)%?,?\s*[/\s]*(-?\d*\.?\d+)?(%)?\s*\)?/i;
      const match = matcher.exec(hsvString);

      if (!match) return { h: 0, s: 0, v: 0, a: 1 };

      return roundHsva({
        h: parseHue(match[1] as string, match[2] as string),
        s: Number(match[3]),
        v: Number(match[4]),
        a: match[5] === undefined ? 1 : Number(match[5]) / (match[6] ? 100 : 1),
      });
    },
    [roundHsva, parseHue],
  );

  const hsvStringToHsva = hsvaStringToHsva;

  const rgbaStringToHsva = useCallback(
    (rgbaString: string): HsvaColor => {
      const matcher =
        /rgba?\(?\s*(-?\d*\.?\d+)(%)?[,\s]+(-?\d*\.?\d+)(%)?[,\s]+(-?\d*\.?\d+)(%)?,?\s*[/\s]*(-?\d*\.?\d+)?(%)?\s*\)?/i;
      const match = matcher.exec(rgbaString);

      if (!match) return { h: 0, s: 0, v: 0, a: 1 };

      return rgbaToHsva({
        r: Number(match[1]) / (match[2] ? 100 / 255 : 1),
        g: Number(match[3]) / (match[4] ? 100 / 255 : 1),
        b: Number(match[5]) / (match[6] ? 100 / 255 : 1),
        a: match[7] === undefined ? 1 : Number(match[7]) / (match[8] ? 100 : 1),
      });
    },
    [rgbaToHsva],
  );

  const rgbStringToHsva = rgbaStringToHsva;

  const rgbaToRgb = useCallback(
    ({ r, g, b }: RgbaColor): RgbColor => ({ r, g, b }),
    [],
  );

  const hslaToHsl = useCallback(
    ({ h, s, l }: HslaColor): HslColor => ({ h, s, l }),
    [],
  );

  const hsvaToHsv = useCallback(
    (hsva: HsvaColor): HsvColor => {
      const { h, s, v } = roundHsva(hsva);
      return { h, s, v };
    },
    [roundHsva],
  );

  return {
    hexToHsva,
    hexToRgba,
    hslaStringToHsva,
    hslStringToHsva,
    hslaToHsva,
    hsvaToHex,
    hsvaToHsla,
    hsvaToHslString,
    hsvaToHsvString,
    hsvaToHsvaString,
    hsvaToHslaString,
    hsvaToRgba,
    hsvaToRgbString,
    hsvaToRgbaString,
    hsvaStringToHsva,
    hsvStringToHsva,
    rgbaStringToHsva,
    rgbStringToHsva,
    rgbaToHex,
    rgbaToHsva,
    rgbaToRgb,
    hslaToHsl,
    hsvaToHsv,
  };
};
