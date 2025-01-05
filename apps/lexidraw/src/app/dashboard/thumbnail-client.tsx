"use client";

import Image from "next/image";
import { useIsDarkTheme } from "~/components/theme/theme-provider";

type Props = {
  darkUrl: string;
  lightUrl: string;
  alt: string;
};

export function ThumbnailClient({ darkUrl, lightUrl, alt }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const src = isDarkTheme ? darkUrl : lightUrl;

  if (src === "") {
    return <ThumbnailFallback />;
  }

  return (
    <Image
      src={src}
      alt={`Thumbnail for ${alt}`}
      width={400}
      height={300}
      crossOrigin="anonymous"
      className="aspect-[4/3]"
      style={{ width: "auto", height: "auto" }}
    />
  );
}

export function ThumbnailFallback() {
  return (
    <div className="aspect-[4/3] min-h-[300px] bg-muted-foreground animate-pulse rounded-sm" />
  );
}
