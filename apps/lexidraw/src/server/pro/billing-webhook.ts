import type { SandboxBilling } from "./billing";
export function sandboxWebhook(getBilling: () => SandboxBilling) {
  return async (request: Request) => {
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 262144) throw new Error();
          chunks.push(part.value);
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
      const signature = request.headers.get("stripe-signature");
      if (!signature) throw new Error();
      await getBilling().webhook(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        signature,
      );
      return Response.json({ received: true });
    } catch {
      return Response.json(
        { error: "Sandbox event rejected" },
        { status: 400 },
      );
    }
  };
}
