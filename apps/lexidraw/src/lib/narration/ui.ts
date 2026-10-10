import type { NarrationSnapshot } from "./contracts";
export type NarrationQuote = {
  periodId: string | null;
  maximum: number;
  missing: number;
  cached: number;
  maxSeconds: number;
  revision: string;
  version: string;
  policy: string;
};
export type NarrationScreen =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string }
  | { kind: "quote"; quote: NarrationQuote }
  | { kind: "job"; job: NarrationSnapshot };
