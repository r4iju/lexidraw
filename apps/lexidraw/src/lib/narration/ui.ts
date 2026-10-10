import type { NarrationSnapshot } from "./contracts";
import type { RouterOutputs } from "~/trpc/shared";
export type NarrationQuote = RouterOutputs["narration"]["quote"];
export type NarrationScreen =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string }
  | { kind: "quote"; quote: NarrationQuote }
  | { kind: "job"; job: NarrationSnapshot };
