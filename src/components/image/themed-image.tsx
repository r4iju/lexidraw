"use client";

import Image, { type ImageProps } from "next/image";
import { useIsDarkTheme } from "../theme/theme-provider";

type Props = {
  src: string;
  alt: string;
  disabled?: boolean;
} & ImageProps;

export default function ThemedImage({ src, alt, disabled, ...props }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const newSrc: string = disabled
    ? src
    : src.replace(
        /(\.png|\.jpg|\.jpeg|\.gif|\.webp)/,
        isDarkTheme ? ".dark$1" : "$1",
      );
  return <Image src={newSrc} alt={alt} {...props} />;
}
