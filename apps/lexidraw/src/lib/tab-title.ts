export const APP_NAME = "Lexidraw";

/** Every tab reads "<what is open> · Lexidraw"; see the root layout. */
export const TITLE_TEMPLATE = `%s · ${APP_NAME}`;

export function tabTitle(title: string): string {
  return TITLE_TEMPLATE.replace("%s", title.trim() || "Untitled");
}
