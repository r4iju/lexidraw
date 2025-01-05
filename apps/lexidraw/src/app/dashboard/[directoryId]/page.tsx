import { api } from "~/trpc/server";
import { Dashboard } from "../dashboard";

type Props = {
  params: Promise<{
    directoryId: string;
  }>;
  searchParams: Promise<{
    parentId?: string;
  }>;
};

export default async function DashboardPage({ params, searchParams }: Props) {
  const directoryId = (await params).directoryId;
  const parentId = (await searchParams).parentId ?? null;
  console.log("directoryId", directoryId);
  await api.entities.create.mutate({
    id: directoryId,
    title: "New folder",
    elements: "{}",
    entityType: "directory",
    parentId: parentId,
  });
  return <Dashboard directoryId={directoryId} />;
}
