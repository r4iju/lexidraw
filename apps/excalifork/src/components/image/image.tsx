import { Suspense } from "react";
import NextImage, { type ImageProps } from "next/image";
import ThemedImage from "./themed-image";

type Props = {
  src: string;
  alt: string;
  disabled?: boolean;
} & ImageProps;

export default function Image({ src, alt, disabled, ...props }: Props) {
  return (
    <Suspense fallback={<NextImage src={src} alt={alt} {...props} />}>
      <ThemedImage src={src} alt={alt} disabled={disabled} {...props} />
    </Suspense>
  );
}
