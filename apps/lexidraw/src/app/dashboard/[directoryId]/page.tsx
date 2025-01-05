import { api } from "~/trpc/server";
import { Dashboard } from "../dashboard";
import { redirect } from "next/navigation";

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

  return <Dashboard directory={directory} />;
}
