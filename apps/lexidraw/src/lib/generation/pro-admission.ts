import { z } from "zod";

export const ProNonAcceptance = z.strictObject({
  kind: z.literal("not_accepted"),
  feature: z.enum([
    "text",
    "chat",
    "autocomplete",
    "image",
    "narration",
    "agent",
  ]),
  idempotencyKey: z.string().min(1).max(100),
  reason: z.enum([
    "request_limit",
    "active_autocomplete",
    "insufficient_credits",
  ]),
});
export type ProNonAcceptance = z.infer<typeof ProNonAcceptance>;

export function confirmedNonAcceptance(
  error: unknown,
  feature: ProNonAcceptance["feature"],
  key: string,
) {
  const parsed = z
    .object({ data: z.object({ proNonAcceptance: ProNonAcceptance }) })
    .safeParse(error);
  return parsed.success &&
    parsed.data.data.proNonAcceptance.feature === feature &&
    parsed.data.data.proNonAcceptance.idempotencyKey === key
    ? parsed.data.data.proNonAcceptance
    : null;
}
