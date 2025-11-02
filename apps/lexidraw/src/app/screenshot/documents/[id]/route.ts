import { NextResponse, type NextRequest } from "next/server";
import { verifyScreenshotToken } from "~/server/auth/screenshot-token";

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
      .toolbar, [data-component-name="Toolbar"], [data-sidebar], header, nav, footer { display:none !important; }
      article { padding:8px 12px; }
    </style>
  </head>
  <body>
    <main id="screenshot-root">
      <iframe id="doc-frame" src="/screenshot/view/${encodeURIComponent(id)}?st=${encodeURIComponent(token)}&theme=${encodeURIComponent(theme)}" style="border:0; width:100%; height:100%;"></iframe>
    </main>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
