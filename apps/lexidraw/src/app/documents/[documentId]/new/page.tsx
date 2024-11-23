// this could be served with a dialog instead of a full page

import { z } from "zod";
import { api } from "~/trpc/server";
import { Button } from "~/components/ui/button";
import Link from "next/link";
import Redirect from "./redirect";
import { emptyContent } from "./initial-content";

export const runtime = "edge";
export const fetchCache = "force-no-store";

const Params = z.object({
  documentId: z.string(),
});

type Props = {
  params: Promise<z.infer<typeof Params>>;
};

export default async function DrawingBoard(props: Props) {
  const param = await props.params;
  const { documentId } = Params.parse(param);

  try {
    await api.entities.create.mutate({
      id: documentId,
      title: "New document",
      entityType: "document",
      elements: JSON.stringify(emptyContent()),
    });
    return (
      <>
        <Redirect documentId={documentId} />
      </>
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An error occurred";
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-lg">Something went wrong</p>
        <p>{errorMessage}</p>
        <Button asChild>
          <Link href={`/dashboard`}>Go to dashboard</Link>
        </Button>
      </div>
    );
  }
}
