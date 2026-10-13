import type { AppleSandboxBilling } from "./apple-billing";
import { z } from "zod";
export function appleSandboxWebhook(billing: () => AppleSandboxBilling) {
  return async (request: Request) => {
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 65536) throw new Error();
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const payload = z
        .strictObject({ signedPayload: z.string().min(1).max(64000) })
        .parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
      await billing().notification(payload.signedPayload);
      return Response.json({ received: true });
    } catch {
      return Response.json(
        { error: "Apple sandbox event rejected" },
        { status: 400 },
      );
    }
  };
}
