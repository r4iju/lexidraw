import {
  PowerPreferenceSchema,
  type PowerPreference,
} from "@packages/types/power-preference";
export {
  PowerPreferenceSchema,
  type PowerPreference,
} from "@packages/types/power-preference";
export function powerPreference(value: unknown): PowerPreference {
  const parsed = PowerPreferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : { mode: "local" };
}
