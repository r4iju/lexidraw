import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { z } from "zod";
import { api } from "~/trpc/server";

const DocumentEditor = dynamic(() => import("./document-editor"), {
  ssr: false,
});

export const runtime = "edge";

const Params = z.object({
  params: z.object({
    documentId: z.string(),
  }),
});

type Props = z.infer<typeof Params>;

export default async function DocumentPage(props: Props) {
  const {
    params: { documentId },
  } = Params.parse(props);

  const document = await api.entities.load.query({ id: documentId });
  if (!document) throw new Error("Document not found");

  try {
    return (
      <DocumentEditor documentId={documentId} elements={document.elements} />
    );
  } catch (error) {
    console.error("Error loading document:", error);
    return redirect("/dashboard");
  }
}
