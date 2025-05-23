import type { JSX } from "react";
import React, { useCallback, useMemo } from "react";
import { ColorInputBaseProps } from "./types";
import { ColorInput } from "./common/ColorInput";

interface HexColorInputProps extends ColorInputBaseProps {
  /** Enables `#` prefix displaying */
  prefixed?: boolean;
  /** Allows `#rgba` and `#rrggbbaa` color formats */
  alpha?: boolean;
}

/** Adds "#" symbol to the beginning of the string */
const prefix = (value: string) => "#" + value;

export const HexColorInput = (props: HexColorInputProps): JSX.Element => {
  const { prefixed, alpha, ...rest } = props;

  /** Escapes all non-hexadecimal characters including "#" */
  const escape = useCallback(
    (value: string) =>
      value.replace(/([^0-9A-F]+)/gi, "").substring(0, alpha ? 8 : 6),
    [alpha],
  );

  const matcher = useMemo(() => /^#?([0-9A-F]{3,8})$/i, []);

  const validHex = useCallback(
    (value: string, alpha?: boolean): boolean => {
      const match = matcher.exec(value);
      const length = match && match[1] ? match[1].length : 0;

      return (
        length === 3 || // '#rgb' format
        length === 6 || // '#rrggbb' format
        (!!alpha && length === 4) || // '#rgba' format
        (!!alpha && length === 8) // '#rrggbbaa' format
      );
    },
    [matcher],
  );

  const validate = useCallback(
    (value: string) => validHex(value, alpha),
    [alpha, validHex],
  );

  return (
    <ColorInput
      {...rest}
      escape={escape}
      format={prefixed ? prefix : undefined}
      process={prefix}
      validate={validate}
    />
  );
};
