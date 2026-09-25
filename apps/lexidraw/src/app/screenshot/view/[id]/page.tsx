import { redirect } from "next/navigation";
import { verifyScreenshotToken } from "~/server/auth/screenshot-token";
import { api } from "~/trpc/server";
import DocumentEditor from "../../../documents/[documentId]/document-editor-client";
import { and, drizzle as db, eq, isNull, schema } from "@packages/drizzle";
import { INITIAL_LLM_CONFIG_FOR_PUBLIC_RENDER } from "~/server/llm/initial-llm-config";
import {
  AccessLevel,
  type EntityType,
  type PublicAccess,
} from "@packages/types";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ st?: string }>;
};

/**
 * A document rendered for the headless browser that takes its thumbnail or a
 * picture of it; not a page for people. Drawings are drawn by the server itself,
 * see `renderDrawingThumbnail`.
 */
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
        updatedAt: schema.entities.updatedAt,
        entityType: schema.entities.entityType,
      })
      .from(schema.entities)
      .where(and(eq(schema.entities.id, id), isNull(schema.entities.deletedAt)))
  )[0];
  if (!row) return redirect("/dashboard");

  if (row.entityType !== "document") return redirect("/dashboard");

  // Handle documents
  const entity = {
    id: row.id,
    title: row.title,
    entityType: row.entityType as EntityType,
    appState: row.appState,
    elements: row.elements,
    publicAccess: row.publicAccess as PublicAccess,
    sharedWith: [] as { userId: string; accessLevel: AccessLevel }[],
    accessLevel: AccessLevel.READ,
    updatedAt: row.updatedAt,
  };

  const iceServers = await api.auth.iceServers.query();

  const initialLlmConfig = INITIAL_LLM_CONFIG_FOR_PUBLIC_RENDER;

  return (
    <div className="w-full h-full overflow-hidden">
      {/* DocumentEditor renders an <article id={`lexical-content-${entity.id}`}> we will clip against */}
      <DocumentEditor
        entity={entity}
        iceServers={iceServers}
        initialLlmConfig={initialLlmConfig}
        signedIn={false}
        renderMode="screenshot"
      />
    </div>
  );
}
