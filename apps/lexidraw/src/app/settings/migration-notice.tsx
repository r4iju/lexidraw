import {
  type MigrationNoticePhase,
  selectMigrationNotice,
} from "./migration-notice-copy";

export function MigrationNotice({ phase }: { phase: MigrationNoticePhase }) {
  const notice = selectMigrationNotice(phase);
  if (!notice) return null;

  return (
    <section
      aria-labelledby="ai-power-migration-notice-title"
      className="space-y-2"
    >
      <h3
        id="ai-power-migration-notice-title"
        className="text-sm font-semibold"
      >
        {notice.title}
      </h3>
      {notice.paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-sm text-muted-foreground">
          {paragraph}
        </p>
      ))}
    </section>
  );
}
