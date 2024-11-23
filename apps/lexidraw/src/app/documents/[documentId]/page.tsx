import type { Metadata, ServerRuntime } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { api } from "~/trpc/server";
import "./index.css";
import DocumentEditor from "./document-editor-client";

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
};

export default async function DocumentPage(props: Props) {
  const param = await props.params;
  const { documentId } = Params.parse(param);

  const document = await api.entities.load.query({ id: documentId });
  const iceServers = await api.auth.iceServers.query();
  if (!document) throw new Error("Document not found");
  const revalidate = async () => {
    "use server";
    revalidatePath(`/documents/${document.id}`, "page");
  };

  try {
    return (
      <DocumentEditor
        revalidate={revalidate}
        entity={document}
        iceServers={iceServers}
      />
    );
  } catch (error) {
    console.error("Error loading document:", error);
    return redirect("/dashboard");
  }
}
