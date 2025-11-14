import { redirect } from "next/navigation";
import { verifyScreenshotToken } from "~/server/auth/screenshot-token";
import { api } from "~/trpc/server";
import DocumentEditor from "../../../documents/[documentId]/document-editor-client";
import { drizzle as db, schema, eq } from "@packages/drizzle";
import type { StoredLlmConfig } from "~/server/api/routers/config";
import { AccessLevel, type PublicAccess } from "@packages/types";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ st?: string; theme?: "light" | "dark" }>;
};

export default async function ScreenshotDocumentPage(props: Props) {
  const [p, s] = await Promise.all([props.params, props.searchParams]);
  const { id } = p;
  const { st } = s;

  // Validate token
  const payload = st ? verifyScreenshotToken(st) : null;
  if (!payload || payload.entityId !== id) {
    return redirect("/dashboard");
  }

  // Load entity directly (token already validated) without requiring session
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
      .where(eq(schema.entities.id, id))
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

  const initialLlmConfig: StoredLlmConfig = {
    chat: {
      modelId: "gpt-5",
      provider: "openai",
      temperature: 0.7,
      maxOutputTokens: 100000,
    },
    autocomplete: {
      modelId: "gpt-5-nano",
      provider: "openai",
      temperature: 0.3,
      maxOutputTokens: 500,
    },
    agent: {
      modelId: "gpt-5",
      provider: "openai",
      temperature: 0.7,
      maxOutputTokens: 100000,
    },
  };

  return (
    <div className="w-full h-full overflow-hidden">
      {/* DocumentEditor renders an <article id={`lexical-content-${entity.id}`}> we will clip against */}
      <DocumentEditor
        entity={entity}
        iceServers={iceServers}
        initialLlmConfig={initialLlmConfig}
        printMode={true}
      />
    </div>
  );
}
