import Link from "next/link";
import { DocumentAgent } from "./document-agent";
export default async function AgentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  return (
    <main className="mx-auto max-w-2xl p-6">
      <DocumentAgent documentId={documentId} />
      <Link href={`/documents/${encodeURIComponent(documentId)}`}>
        Return to document
      </Link>
    </main>
  );
}
