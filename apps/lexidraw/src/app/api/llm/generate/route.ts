import { auth } from "~/server/auth";
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  return new Response(
    "Legacy system-key forwarding is unavailable. Use a bounded account operation or device AI.",
    { status: 410 },
  );
}
