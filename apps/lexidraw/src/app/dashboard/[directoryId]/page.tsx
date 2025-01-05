import { api } from "~/trpc/server";
import { Dashboard } from "../dashboard";

type Props = {
  params: Promise<{
    directoryId: string;
  }>;
  searchParams: Promise<{
    parentId?: string;
    new?: "true";
  }>;
};

export default async function DashboardPage({ params, searchParams }: Props) {
  const directoryId = (await params).directoryId;
  const queryParams = await searchParams;
  const parentId = queryParams.parentId ?? null;
  const isNew = !!queryParams.new;

  if (isNew) {
    await api.entities.create.mutate({
      id: directoryId,
      title: "New folder",
      elements: "{}",
      entityType: "directory",
      parentId: parentId,
    });
  }
  const entity = await api.entities.getMetadata.query({ id: directoryId });

  return <Dashboard directory={entity} />;
}
