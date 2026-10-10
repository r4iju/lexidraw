import { z } from "zod";
import { TextBook, PRICEBOOK_V1 } from "./contracts";
import { NarrationBook, NARRATION_BOOK_V1 } from "~/lib/narration/contracts";
import { AgentBook } from "~/lib/agent/contracts";
import { ImagePricebook } from "~/lib/images/contracts";

const Unavailable = z.strictObject({ status: z.literal("unavailable") });
export const PeriodRates = z.strictObject({
  version: z.literal("period-rates-v2"),
  text: TextBook,
  narration: NarrationBook,
  image: z.discriminatedUnion("status", [
    Unavailable,
    z.strictObject({ status: z.literal("available"), book: ImagePricebook }),
  ]),
  agent: z.discriminatedUnion("status", [
    Unavailable,
    z.strictObject({ status: z.literal("available"), book: AgentBook }),
  ]),
});
export type PeriodRates = z.infer<typeof PeriodRates>;
const LegacyRates = z.strictObject({
  version: z.literal("period-rates-v1"),
  text: TextBook,
  narration: NarrationBook,
  image: ImagePricebook.nullable(),
  agent: AgentBook.nullable(),
});
export function decodePeriodRates(value: string): PeriodRates {
  const raw: unknown = JSON.parse(value);
  const snapshot = PeriodRates.safeParse(raw);
  if (snapshot.success) return snapshot.data;
  const old = LegacyRates.safeParse(raw);
  if (old.success)
    return PeriodRates.parse({
      ...old.data,
      version: "period-rates-v2",
      image: old.data.image
        ? { status: "available", book: old.data.image }
        : { status: "unavailable" },
      agent: old.data.agent
        ? { status: "available", book: old.data.agent }
        : { status: "unavailable" },
    });
  const legacy = TextBook.parse(raw);
  if (legacy.version !== PRICEBOOK_V1.version)
    throw new Error("Unknown legacy period rate version");
  return PeriodRates.parse({
    version: "period-rates-v2",
    text: legacy,
    narration: NARRATION_BOOK_V1,
    image: { status: "unavailable" },
    agent: { status: "unavailable" },
  });
}
