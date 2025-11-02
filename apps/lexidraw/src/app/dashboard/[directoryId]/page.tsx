import { Suspense } from "react";
import { api } from "~/trpc/server";
import { Dashboard } from "../dashboard";
import { DashboardSkeleton } from "../skeleton";
import { redirect } from "next/navigation";
import { z } from "zod";

const SearchParams = z.object({
  parentId: z.string().optional().nullable().default(null),
  new: z.literal("true").optional(),
  flex: z.enum(["flex-row", "flex-col"]).default("flex-col"),
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  tags: z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
  onlyFavorites: z.coerce.boolean().optional().default(false),
});

type SearchParams = z.infer<typeof SearchParams>;

type Props = {
  params: Promise<{
    directoryId: string;
  }>;
  searchParams: Promise<SearchParams>;
};

async function DashboardContent({ params, searchParams }: Props) {
  const directoryId = (await params).directoryId;
  const queryParams = await searchParams;
  const {
    parentId,
    new: isNew,
    sortBy,
    sortOrder,
    flex,
    tags,
    includeArchived,
    onlyFavorites,
  } = SearchParams.parse(queryParams);

  if (isNew) {
    console.log("creating new directory");
    console.log({ parentId });
    await api.entities.create.mutate({
      id: directoryId,
      title: "New folder",
      elements: "{}",
      entityType: "directory",
      parentId: parentId,
    });
    return redirect(`/dashboard/${directoryId}`);
  }
  const directory = await api.entities.getMetadata.query({ id: directoryId });

  return (
    <Dashboard
      directory={directory}
      sortBy={sortBy}
      sortOrder={sortOrder}
      flex={flex}
      tags={tags}
      includeArchived={includeArchived}
      onlyFavorites={onlyFavorites}
    />
  );
}

export default function DashboardPage(props: Props) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}
