"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
};

export function Thumbnail({ entity }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const [svgDataUrl, setSvgDataUrl] = useState<string>(
    isDarkTheme ? entity.screenShotDark : entity.screenShotLight,
  );

  useEffect(() => {
    setSvgDataUrl(isDarkTheme ? entity.screenShotDark : entity.screenShotLight);
  }, [isDarkTheme, entity.screenShotDark, entity.screenShotLight]);

  return (
    <Image
      src={svgDataUrl}
      className="aspect-[4/3] min-h-[300px]"
      alt={`Thumbnail for ${entity.title}`}
      height={300}
      width={400}
      typeof="image/svg+xml"
    />
  );
}
