import { auth } from "~/server/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // If client-orchestrated mode is enabled, short-circuit to reduce duplication
    return Response.json({
      text: "",
      toolCalls: [],
    });
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
}
