import { api } from "~/trpc/server";
import { Dashboard } from "../dashboard";
import { redirect } from "next/navigation";
import type { ServerRuntime } from "next/types";
import { z } from "zod";

export const runtime: ServerRuntime = "edge";

const SearchParams = z.object({
  parentId: z.string().optional().nullable().default(null),
  new: z.literal("true").optional(),
  sortBy: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

type SearchParams = z.infer<typeof SearchParams>;

type Props = {
  params: Promise<{
    directoryId: string;
  }>;
  searchParams: Promise<SearchParams>;
};

export default async function DashboardPage({ params, searchParams }: Props) {
  const directoryId = (await params).directoryId;
  const queryParams = await searchParams;
  const {
    parentId,
    new: isNew,
    sortBy,
    sortOrder,
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
    <Dashboard directory={directory} sortBy={sortBy} sortOrder={sortOrder} />
  );
}
