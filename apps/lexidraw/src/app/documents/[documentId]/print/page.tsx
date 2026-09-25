"use cache: private";

import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { redirect } from "next/navigation";
import { entityTag } from "~/server/api/entity-cache";
import { verifyPrintToken } from "~/server/auth/print-token";
import { and, drizzle as db, eq, isNull, schema } from "@packages/drizzle";
import type { EntityType, PublicAccess } from "@packages/types";
import { AccessLevel } from "@packages/types";
import DocumentEditor from "../document-editor-client";
import { api } from "~/trpc/server";
import { INITIAL_LLM_CONFIG_FOR_PUBLIC_RENDER } from "~/server/llm/initial-llm-config";
import { runningHeaderCss } from "~/lib/running-header";

const Params = {
  parse: (params: { documentId: string }) => ({
    documentId: params.documentId,
  }),
};

type Props = {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ token?: string }>;
};

/** The title a PDF made from this page carries in its metadata. */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const { documentId } = Params.parse(params);
  cacheTag(entityTag(documentId));
  const payload = searchParams.token
    ? verifyPrintToken(searchParams.token)
    : null;
  if (payload?.entityId !== documentId) return {};
  const row = (
    await db
      .select({ title: schema.entities.title })
      .from(schema.entities)
      .where(
        and(
          eq(schema.entities.id, documentId),
          isNull(schema.entities.deletedAt),
        ),
      )
  )[0];
  return row ? { title: { absolute: row.title } } : {};
}

export default async function PrintDocumentPage(props: Props) {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const { documentId } = Params.parse(params);
  const { token } = searchParams;

  // Same tag the editor page carries: a write over any transport drops this
  // render too, so a print never shows a revision the document no longer has.
  cacheTag(entityTag(documentId));

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
        entityType: schema.entities.entityType,
        appState: schema.entities.appState,
        elements: schema.entities.elements,
        publicAccess: schema.entities.publicAccess,
        updatedAt: schema.entities.updatedAt,
      })
      .from(schema.entities)
      .where(
        and(
          eq(schema.entities.id, documentId),
          isNull(schema.entities.deletedAt),
        ),
      )
  )[0];
  if (!row) return redirect("/dashboard");

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
    <div className="print-container">
      <style>{runningHeaderCss(entity.title)}</style>
      <DocumentEditor
        entity={entity}
        iceServers={iceServers}
        initialLlmConfig={initialLlmConfig}
        signedIn={false}
        renderMode="print"
      />
    </div>
  );
}
