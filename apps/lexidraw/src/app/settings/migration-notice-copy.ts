export type MigrationNoticePhase = "absent" | "advance";

export type MigrationNoticeCopy = {
  title: string;
  paragraphs: readonly string[];
};

export function selectMigrationNotice(
  phase?: unknown,
): MigrationNoticeCopy | null {
  if (phase !== "advance") return null;

  return {
    title: "Planned changes to cloud AI",
    paragraphs: [
      "The planned change would move new cloud AI generation supplied by Lexidraw to Pro. This advance notice does not announce that the change has taken effect.",
      "Pro is Coming soon and is not available for public purchase.",
      "Core writing and drawing remain free. This informational notice does not change your documents, drawings, or saved recordings. The planned cloud AI transition is intended to preserve them.",
      "BYOK and local AI are possible alternatives. Their availability for each feature on this device has not been confirmed in this notice.",
    ],
  };
}
