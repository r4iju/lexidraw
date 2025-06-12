import type { Metadata, ServerRuntime } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { api } from "~/trpc/server";
import DocumentEditor from "./document-editor-client";
import { EMPTY_CONTENT } from "./initial-content";

export const metadata: Metadata = {
  title: "Lexidraw | document",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

export const runtime: ServerRuntime = "edge"; // some plugins like code+formatter with prettier are quite large
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Params = z.object({
  documentId: z.string(),
});

type Props = {
  params: Promise<z.infer<typeof Params>>;
  searchParams: Promise<{
    new?: "true";
    parentId?: string;
  }>;
};

export default async function DocumentPage(props: Props) {
  console.log("🔄 DocumentPage re-rendered");
  const param = await props.params;
  const { documentId } = Params.parse(param);
  const { new: isNew, parentId } = await props.searchParams;

  if (isNew === "true") {
    await api.entities.create.mutate({
      id: documentId,
      title: "New document",
      entityType: "document",
      elements: JSON.stringify(EMPTY_CONTENT),
      parentId: parentId ?? null,
    });
    return redirect(`/documents/${documentId}`);
  }

  const [document, iceServers, initialLlmConfig] = await Promise.all([
    api.entities.load.query({ id: documentId }),
    api.auth.iceServers.query(),
    api.config.getConfig.query(),
  ]);
  if (!document) throw new Error("Document not found");

  try {
    return (
      <DocumentEditor
        entity={document}
        iceServers={iceServers}
        initialLlmConfig={initialLlmConfig}
      />
    );
  } catch (error) {
    console.error("Error loading document:", error);
    return redirect("/dashboard");
  }
}
