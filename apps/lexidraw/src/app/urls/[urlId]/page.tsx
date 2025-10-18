import type { Metadata, ServerRuntime } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { api } from "~/trpc/server";

export const metadata: Metadata = {
  title: "Lexidraw | url",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

export const runtime: ServerRuntime = "edge";
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Params = z.object({
  urlId: z.string(),
});

type Props = {
  params: Promise<z.infer<typeof Params>>;
  searchParams: Promise<{
    new?: "true";
    parentId?: string;
  }>;
};

export default async function UrlPage(props: Props) {
  const [param, search] = await Promise.all([props.params, props.searchParams]);
  const { urlId } = Params.parse(param);
  const { new: isNew, parentId } = search ?? {};

  if (isNew === "true") {
    await api.entities.create.mutate({
      id: urlId,
      title: "New link",
      entityType: "url",
      elements: JSON.stringify({ url: "" }),
      parentId: parentId ?? null,
    });
    return redirect(`/urls/${urlId}`);
  }

  const entity = await api.entities.load.query({ id: urlId });
  if (!entity) throw new Error("URL entity not found");

  const UrlEditor = (await import("./url-editor-client")).default;
  return <UrlEditor entity={entity} />;
}
