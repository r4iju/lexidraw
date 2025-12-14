"use cache: private";

import { redirect } from "next/navigation";
import { verifyPrintToken } from "~/server/auth/print-token";
import { drizzle as db, schema, eq } from "@packages/drizzle";
import type { PublicAccess } from "@packages/types";
import { AccessLevel } from "@packages/types";
import DocumentEditor from "../document-editor-client";
import { api } from "~/trpc/server";
import { INITIAL_LLM_CONFIG_FOR_PUBLIC_RENDER } from "~/server/llm/initial-llm-config";

const Params = {
  parse: (params: { documentId: string }) => ({
    documentId: params.documentId,
  }),
};

type Props = {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default async function PrintDocumentPage(props: Props) {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const { documentId } = Params.parse(params);
  const { token } = searchParams;

  // Validate token (for server renderer) or check session (for user preview)
  if (token) {
    const payload = verifyPrintToken(token);
    if (!payload || payload.entityId !== documentId) {
      return redirect("/dashboard");
    }
  } else {
    // For user preview: check session via TRPC
    try {
      await api.entities.load.query({ id: documentId });
    } catch {
      return redirect("/dashboard");
    }
  }

  // Load entity
  const row = (
    await db
      .select({
        id: schema.entities.id,
        title: schema.entities.title,
        appState: schema.entities.appState,
        elements: schema.entities.elements,
        publicAccess: schema.entities.publicAccess,
      })
      .from(schema.entities)
      .where(eq(schema.entities.id, documentId))
  )[0];
  if (!row) return redirect("/dashboard");

  const entity = {
    id: row.id,
    title: row.title,
    appState: row.appState,
    elements: row.elements,
    publicAccess: row.publicAccess as PublicAccess,
    sharedWith: [] as { userId: string; accessLevel: AccessLevel }[],
    accessLevel: AccessLevel.READ,
  };

  const iceServers = await api.auth.iceServers.query();

  const initialLlmConfig = INITIAL_LLM_CONFIG_FOR_PUBLIC_RENDER;

  return (
    <div className="print-container">
      <DocumentEditor
        entity={entity}
        iceServers={iceServers}
        initialLlmConfig={initialLlmConfig}
        printMode
      />
    </div>
  );
}
