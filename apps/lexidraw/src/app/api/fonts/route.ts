import { z } from "zod";

const familySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N} -]+$/u);

export async function GET(request: Request) {
  const parsed = familySchema.safeParse(
    new URL(request.url).searchParams.get("family"),
  );
  if (!parsed.success)
    return new Response("Invalid font family", { status: 400 });
  const family = encodeURIComponent(parsed.data).replace(/%20/g, "+");
  // Google rejects an entire CSS2 request when a face has no italic axis.
  for (const axes of [
    "ital,wght@0,400;0,700;1,400;1,700",
    "wght@400;700",
    "wght@400",
  ]) {
    const response = await fetch(
      `https://fonts.googleapis.com/css2?family=${family}:${axes}&display=swap`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
        },
        next: { revalidate: 86400 },
      },
    );
    if (response.ok)
      return new Response(await response.text(), {
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
        },
      });
    if (response.status !== 400)
      return new Response("Font provider unavailable", { status: 502 });
  }
  return new Response("Font not found", { status: 404 });
}
