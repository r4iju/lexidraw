export const SETTINGS_SECTIONS = [
  { id: "settings-account", label: "Account" },
  { id: "settings-editor", label: "Editor" },
  { id: "settings-ai", label: "AI" },
  { id: "settings-read-aloud", label: "Read aloud" },
  { id: "api-tokens", label: "API tokens" },
  { id: "delete-account", label: "Delete account" },
] as const;

/** The sections of Settings: a column beside them on wide screens, a list above them on phones. */
export function SettingsNav() {
  return (
    <nav aria-label="Settings sections">
      <ul className="flex flex-col gap-1">
        {SETTINGS_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground pointer-coarse:min-h-11"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
