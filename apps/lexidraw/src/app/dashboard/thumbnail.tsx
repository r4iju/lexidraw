"use client";

import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
};

export function Thumbnail({ entity }: Props) {
  const isDarkTheme = useIsDarkTheme();
  const src = isDarkTheme ? entity.screenShotDark : entity.screenShotLight;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      className="aspect-[4/3] min-h-[300px]"
      alt={`Thumbnail for ${entity.title}`}
      height={300}
      width={400}
      typeof="image/svg+xml"
    />
  );
}
