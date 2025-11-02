import { EntityCardSkeletonRow } from "./entity-card-skeleton-row";
import { EntityCardSkeletonCol } from "./entity-card-skeleton-col";

type Props = {
  flex: "flex-row" | "flex-col";
};

export function EntityCardSkeleton({ flex }: Props) {
  if (flex === "flex-row") {
    return <EntityCardSkeletonRow />;
  }

  return <EntityCardSkeletonCol />;
}
