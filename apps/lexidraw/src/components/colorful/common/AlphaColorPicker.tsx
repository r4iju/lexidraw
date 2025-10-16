import type { JSX } from "react";
import { useRef } from "react";
import { Hue } from "./Hue";
import { Saturation } from "./Saturation";
import { Alpha } from "./Alpha";
import type { ColorModel, ColorPickerBaseProps, AnyColor } from "../types";
import { useColorManipulation } from "../hooks/useColorManipulation";
import { cn } from "~/lib/utils";

interface Props<T extends AnyColor> extends Partial<ColorPickerBaseProps<T>> {
  colorModel: ColorModel<T>;
}

export const AlphaColorPicker = <T extends AnyColor>({
  className,
  colorModel,
  color = colorModel.defaultColor,
  onChange,
  ...rest
}: Props<T>): JSX.Element => {
  const nodeRef = useRef<HTMLDivElement>(null);

  const [hsva, updateHsva] = useColorManipulation<T>(
    colorModel,
    color,
    onChange,
  );

  return (
    <div
      {...rest}
      ref={nodeRef}
      className={cn(
        "relative flex flex-col size-[200px] user-select-none cursor-default",
        className,
      )}
    >
      <Saturation hsva={hsva} onChange={updateHsva} />
      <Hue hue={hsva.h} onChange={updateHsva} />
      <Alpha hsva={hsva} onChange={updateHsva} className="rounded-b-md" />
    </div>
  );
};
