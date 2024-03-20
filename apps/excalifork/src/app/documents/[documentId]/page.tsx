import { redirect } from "next/navigation";
import { z } from "zod";
import DocumentEditor from "./doc-edit";

export const runtime = "edge";

const Params = z.object({
  params: z.object({
    documentId: z.string(),
  }),
  searchParams: z.object({
    new: z.string().optional(),
  }),
});

type Props = z.infer<typeof Params>;

export default async function DocumentPage(props: Props) {
  const {
    params: { documentId },
    searchParams,
  } = Params.parse(props);

  try {
    return (
      <div className="flex w-full h-full items-center justify-center">
        <DocumentEditor />
      </div>
    );
  } catch (error) {
    console.error("Error loading document:", error);
    return redirect("/dashboard");
  }
}
