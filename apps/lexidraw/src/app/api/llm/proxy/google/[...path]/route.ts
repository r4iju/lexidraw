import { auth } from "~/server/auth";

async function closed(
  _req: Request,
  _ctx: { params: Promise<{ path?: string[] }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  return new Response(
    "Legacy provider forwarding is unavailable. Choose AI Power for supported actions. Saved documents and recordings remain available.",
    { status: 410 },
  );
}

export {
  closed as GET,
  closed as HEAD,
  closed as POST,
  closed as PUT,
  closed as PATCH,
  closed as DELETE,
};
