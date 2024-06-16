"use client";

import { useEffect, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { api } from "~/trpc/react";
import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
};

export function Thumbnail({ entity }: Props) {
  const isDarkTheme = useIsDarkTheme();

  const { data } = api.snapshot.getSvgData.useQuery({
    entityId: entity.id,
    theme: isDarkTheme ? "dark" : "light",
  });

  const [svgDataUrl, setSvgDataUrl] = useState<string>(
    isDarkTheme ? entity.screenShotDark : entity.screenShotLight,
  );

  useEffect(() => {
    setSvgDataUrl(
      data || (isDarkTheme ? entity.screenShotDark : entity.screenShotLight),
    );
  }, [data, isDarkTheme, entity.screenShotDark, entity.screenShotLight]);

  return (
    <img
      src={svgDataUrl}
      className="aspect-[4/3] min-h-[300px]"
      alt={`Thumbnail for ${entity.title}`}
      height={300}
      width={400}
      typeof="image/svg+xml"
    />
  );
}
