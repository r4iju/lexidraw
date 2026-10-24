import {
  type MigrationNoticePhase,
  selectMigrationNotice,
} from "./migration-notice-copy";

export function MigrationNotice({ phase }: { phase: MigrationNoticePhase }) {
  const notice = selectMigrationNotice(phase);
  if (!notice) return null;

  return (
    <details
      aria-labelledby="ai-power-migration-notice-title"
      className="rounded-md border border-border px-3 py-2 text-sm"
    >
      <summary
        id="ai-power-migration-notice-title"
        className="cursor-pointer select-none font-medium"
      >
        {notice.title}
      </summary>
      <div className="mt-2 space-y-2 text-muted-foreground">
        {notice.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </details>
  );
}
