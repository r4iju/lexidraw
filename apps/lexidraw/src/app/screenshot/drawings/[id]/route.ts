import { NextResponse, type NextRequest } from "next/server";
import { verifyScreenshotToken } from "~/server/auth/screenshot-token";

/**
 * Screenshot route for drawings.
 *
 * This route exists specifically for server-side thumbnail generation via headless browser rendering.
 * Unlike documents which can be rendered server-side, drawings require browser APIs to render
 * Excalidraw canvases. We use a headless browser service to:
 * 1. Load this HTML wrapper page
 * 2. Render the drawing via an iframe pointing to /screenshot/view/[id]
 * 3. Capture a screenshot of the rendered drawing
 *
 * This approach is necessary because @excalidraw/excalidraw's exportToBlob API requires browser
 * APIs (window, DOM) that don't exist in Node.js server environments. Workflow steps run server-side,
 * so we must use a headless browser service to render the drawing and capture a screenshot.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const url = new URL(req.url);
  const token = url.searchParams.get("st") || "";
  const theme = (url.searchParams.get("theme") || "light") as "light" | "dark";
  const width = Math.max(
    200,
    Math.min(2000, Number(url.searchParams.get("width") || 500)),
  );
  const height = Math.max(
    150,
    Math.min(2000, Number(url.searchParams.get("height") || 400)),
  );

  const verified = verifyScreenshotToken(token);
  const { id } = await params;
  if (!verified || verified.entityId !== id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const html = `<!DOCTYPE html>
<html lang="en" class="${theme === "dark" ? "dark" : ""}" style="color-scheme:${theme}">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin:0; padding:0; }
      body { background:${theme === "dark" ? "#0a0a0a" : "#ffffff"}; color:${theme === "dark" ? "#e5e7eb" : "#111827"}; }
      *, *::before, *::after { animation: none !important; transition: none !important; }
      #screenshot-root { width:${width}px; height:${height}px; overflow:hidden; }
      [data-sidebar], header, nav, footer { display:none !important; }
      /* Hide cursors/presence and Next.js overlays */
      [data-cursor], [data-presence], [data-presence-root], .presence, .cursor,
      #nextjs-portal-root, [data-nextjs-overlay], [data-nextjs-error-overlay],
      [data-nextjs-toast], [data-nextjs-dialog] { display:none !important; }
      * { cursor:none !important; }
    </style>
  </head>
  <body>
    <main id="screenshot-root">
      <iframe id="drawing-frame" src="/screenshot/view/${encodeURIComponent(id)}?st=${encodeURIComponent(token)}&theme=${encodeURIComponent(theme)}" style="border:0; width:100%; height:100%;"></iframe>
    </main>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
