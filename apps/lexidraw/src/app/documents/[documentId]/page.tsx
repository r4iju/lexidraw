"use cache: private";

import type { Metadata, Viewport } from "next";
import { cacheTag } from "next/cache";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { entityTag } from "~/server/api/entity-cache";
import { auth } from "~/server/auth";
import { entityFrame } from "~/server/app-bar-account";
import { api } from "~/trpc/server";
import { notFoundOr } from "~/trpc/not-found";
import DocumentEditor from "./document-editor-client";
import { EMPTY_CONTENT } from "./initial-content";

const APPLE_WEB_APP: Metadata["appleWebApp"] = {
  capable: true,
  statusBarStyle: "black",
  title: "Lexidraw",
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { documentId } = await props.params;
  cacheTag(entityTag(documentId));
  const document = await api.entities.getMetadata
    .query({ id: documentId })
    .catch(() => null);
  return {
    title: document?.title || "Document",
    appleWebApp: APPLE_WEB_APP,
  };
}

// The page extends under the notch and home indicator; the frame pads
// itself by the safe areas.
export const viewport: Viewport = {
  viewportFit: "cover",
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

  // A missing document, or one this caller may not read, is a 404.
  const document = await api.entities.load
    .query({ id: documentId })
    .catch(notFoundOr);
  const [iceServers, initialLlmConfig, session, frame] = await Promise.all([
    api.auth.iceServers.query(),
    // A visitor without an account reads the defaults.
    api.config.getConfig.query(),
    auth(),
    entityFrame(documentId),
  ]);

  try {
    return (
      <DocumentEditor
        entity={document}
        iceServers={iceServers}
        initialLlmConfig={initialLlmConfig}
        signedIn={Boolean(session?.user)}
        frame={frame}
      />
    );
  } catch (error) {
    console.error("Error loading document:", error);
    return redirect("/dashboard");
  }
}
