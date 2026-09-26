import { drizzle } from "@packages/drizzle";
import { auth } from "~/server/auth";
import {
  issueNativeSignInCode,
  NativeSignInRequest,
} from "~/server/auth/native-sign-in";

const refuse = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

/**
 * The consent form has to come from our own page. Without this, any site the
 * user visits could submit it with a challenge of its own and have the code
 * delivered to whatever app on the device claims the callback's scheme.
 */
function fromOwnPage(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The signed-in user approved a native app on /native-sign-in: a one-time code
 * goes to the app's callback, never the token itself. Nothing but an
 * allow-listed callback is ever redirected to.
 */
export async function POST(req: Request) {
  if (!fromOwnPage(req)) return refuse(403, "Cross-site request refused");

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return refuse(401, "Sign in again, then retry from the app");

  let fields: Record<string, unknown>;
  try {
    fields = Object.fromEntries(await req.formData());
  } catch {
    return refuse(400, "Unreadable sign-in request");
  }
  const request = NativeSignInRequest.safeParse(fields);
  if (!request.success) return refuse(400, "Invalid sign-in request");

  const callback = await issueNativeSignInCode(drizzle, userId, request.data);
  return new Response(null, {
    status: 303,
    headers: {
      location: callback.toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
