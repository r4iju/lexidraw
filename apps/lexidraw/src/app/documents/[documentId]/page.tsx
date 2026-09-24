"use cache: private";

import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { entityTag } from "~/server/api/entity-cache";
import { api } from "~/trpc/server";
import { notFoundOr } from "~/trpc/not-found";
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

  // Guard against sourcemaps or invalid IDs hitting this route
  if (
    documentId.endsWith(".map") ||
    !/^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$/.test(
      documentId,
    )
  ) {
    return notFound();
  }

  // What this render is about, so a write to it anywhere — the browser, the
  // REST path, MCP, the CLI — drops this entry instead of leaving a stale
  // document on screen until it expires.
  cacheTag(entityTag(documentId));

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
    api.entities.load.query({ id: documentId }).catch(notFoundOr),
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
