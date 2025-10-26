export function normalizeLanguageCode(code: string | undefined | null): string {
  if (!code) return "";
  // Replace underscore with dash and ensure region uppercase
  const c = code.replace("_", "-");
  const [lang, region] = c.split("-");
  if (!region) return lang?.toLowerCase() ?? "";
  return `${lang?.toLowerCase() ?? ""}-${region.toUpperCase()}`;
}

export function labelForLanguage(code: string | undefined | null): string {
  const norm = normalizeLanguageCode(code);
  if (!norm) return "";
  const map: Record<string, string> = {
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "ja-JP": "Japanese",
    "sv-SE": "Swedish",
    "de-DE": "German",
    "fr-FR": "French",
    "it-IT": "Italian",
    "pt-PT": "Portuguese",
    "ru-RU": "Russian",
    "nl-NL": "Dutch",
    "cs-CZ": "Czech",
    "ar-SA": "Arabic",
    "zh-CN": "Chinese (Simplified)",
    "hu-HU": "Hungarian",
    "ko-KR": "Korean",
    "hi-IN": "Hindi",
  };
  if (map[norm]) return map[norm];
  try {
    const [lang, region] = norm.split("-");
    const dn = new Intl.DisplayNames(["en"], { type: "language" });
    if (!lang) return norm;
    const ln = dn.of(lang) as string | undefined;
    if (ln && region) return `${ln} (${region})`;
    return ln || norm;
  } catch {
    return norm;
  }
}

export function titleize(input: string | undefined | null): string {
  if (!input) return "";
  const s = String(input);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
