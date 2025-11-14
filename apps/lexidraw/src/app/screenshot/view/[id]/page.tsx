import { redirect } from "next/navigation";
import { verifyScreenshotToken } from "~/server/auth/screenshot-token";
import { api } from "~/trpc/server";
import DocumentEditor from "../../../documents/[documentId]/document-editor-client";
import DrawingScreenshotView from "../drawing-screenshot-view";
import { drizzle as db, schema, eq } from "@packages/drizzle";
import type { StoredLlmConfig } from "~/server/api/routers/config";
import { AccessLevel, type PublicAccess } from "@packages/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ st?: string; theme?: "light" | "dark" }>;
};

/**
 * Screenshot view page for both documents and drawings.
 *
 * This page renders entities (documents or drawings) specifically for screenshot capture
 * by a headless browser service. It is NOT intended for direct user viewing.
 *
 * For drawings: We use screenshots instead of @excalidraw/excalidraw's exportToBlob API
 * because exportToBlob requires browser APIs (window, DOM) that don't exist in Node.js
 * server environments. Workflow steps run server-side, so we must use a headless browser
 * service to render the drawing and capture a screenshot.
 */
export default async function ScreenshotDocumentPage(props: Props) {
  const [p, s] = await Promise.all([props.params, props.searchParams]);
  const { id } = p;
  const { st, theme = "light" } = s;

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
        entityType: schema.entities.entityType,
      })
      .from(schema.entities)
      .where(eq(schema.entities.id, id))
  )[0];
  if (!row) return redirect("/dashboard");

  // Handle drawings - render using Excalidraw component for screenshot capture
  if (row.entityType === "drawing") {
    // Construct drawing object from database row (no TRPC API call needed - token already validated)
    const drawing = {
      id: row.id,
      title: row.title,
      appState: row.appState,
      elements: row.elements,
      publicAccess: row.publicAccess as PublicAccess,
      sharedWith: [] as { userId: string; accessLevel: AccessLevel }[],
      accessLevel: AccessLevel.READ,
    };

    const parsedAppState = drawing.appState
      ? (JSON.parse(drawing.appState) as unknown as AppState)
      : undefined;

    const parsedElements = drawing.elements
      ? (JSON.parse(drawing.elements) as unknown as ExcalidrawElement[]).map(
          (el) => {
            if (
              ["freedraw", "line", "arrow"].includes(el.type) &&
              !("points" in el)
            ) {
              return {
                ...(el as unknown as ExcalidrawElement),
                points: [] as const,
              };
            }
            return el;
          },
        )
      : undefined;

    return (
      <DrawingScreenshotView
        drawing={drawing}
        theme={theme as "light" | "dark"}
        appState={parsedAppState}
        elements={parsedElements}
      />
    );
  }

  // Handle documents
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
