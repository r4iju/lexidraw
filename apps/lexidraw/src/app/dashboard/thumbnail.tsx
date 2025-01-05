import type { RouterOutputs } from "~/trpc/shared";
import { ThumbnailClient } from "./thumbnail-client";
import { Folder } from "lucide-react";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
};

// can cache this
export async function Thumbnail({ entity }: Props) {
  if (
    entity.entityType === "directory" &&
    !entity.screenShotDark &&
    !entity.screenShotLight
  ) {
    return (
      <div className="aspect-[4/3] h-[300px]">
        <Folder className="size-full" />
      </div>
    );
  }
  try {
    return (
      <ThumbnailClient
        darkUrl={entity.screenShotDark}
        lightUrl={entity.screenShotLight}
        alt={entity.title}
      />
    );
  } catch (error) {
    console.error("Error fetching thumbnail", error);
    return <BrokenImage />;
  }
}

function BrokenImage() {
  return (
    <div className="aspect-[4/3] min-h-[300px] bg-muted-foreground rounded-sm" />
  );
}
