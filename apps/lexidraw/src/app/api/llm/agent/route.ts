import { auth } from "~/server/auth";
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  return new Response(
    "Use the bounded document action. Legacy agent forwarding is unavailable.",
    { status: 410 },
  );
}
