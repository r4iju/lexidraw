import { auth } from "~/server/auth";
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  return new Response(
    "Client and sandbox callbacks cannot authorize paid work or certify document edits. Use the bounded server action.",
    { status: 410 },
  );
}
