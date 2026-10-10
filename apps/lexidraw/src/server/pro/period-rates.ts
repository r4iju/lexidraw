import { z } from "zod";
import { TextBook, PRICEBOOK_V1 } from "./contracts";
import { NarrationBook, NARRATION_BOOK_V1 } from "~/lib/narration/contracts";
import { AgentBook } from "~/lib/agent/contracts";
import { ImagePricebook } from "~/lib/images/contracts";

export const PeriodRates = z.strictObject({
  version: z.literal("period-rates-v1"),
  text: TextBook,
  narration: NarrationBook,
  // These gated integrations have no verified production book. Pin their complete
  // adapter book at first quote, including tool capability, under the period lock.
  image: ImagePricebook.nullable(),
  agent: AgentBook.nullable(),
});
export type PeriodRates = z.infer<typeof PeriodRates>;
export function decodePeriodRates(value: string): PeriodRates {
  const raw: unknown = JSON.parse(value);
  const snapshot = PeriodRates.safeParse(raw);
  if (snapshot.success) return snapshot.data;
  const legacy = TextBook.parse(raw);
  if (legacy.version !== PRICEBOOK_V1.version)
    throw new Error("Unknown legacy period rate version");
  return PeriodRates.parse({
    version: "period-rates-v1",
    text: legacy,
    narration: NARRATION_BOOK_V1,
    image: null,
    agent: null,
  });
}
