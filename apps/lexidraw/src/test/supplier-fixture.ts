// Server-owned synthetic schedules for executable tests. Never imported by production runtime.
import { PRICEBOOK } from "~/server/pro/contracts";
import { NARRATION_BOOK } from "~/lib/narration/contracts";
import { IMAGE_FIXTURE_PRICEBOOK } from "~/lib/images/contracts";
import { AGENT_BOOK } from "~/lib/agent/contracts";
export const supplierFixture = () => ({
  verification: "test-injection" as const,
  text: PRICEBOOK,
  narration: NARRATION_BOOK,
  image: IMAGE_FIXTURE_PRICEBOOK,
  agent: AGENT_BOOK,
});
