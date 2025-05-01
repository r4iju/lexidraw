/**
 * Parses a CSS style string into an object.
 * Handles potential null/undefined input and extra/missing semicolons.
 *
 * @param styleString The CSS style string (e.g., "color: red; font-size: 12px;")
 * @returns An object representation (e.g., { color: "red", "font-size": "12px" })
 */
export function parseStyleString(
  styleString: string | null | undefined,
): Record<string, string> {
  const styleObj: Record<string, string> = {};
  if (!styleString) {
    return styleObj;
  }
  // Split by semicolon, handling potential trailing semicolon
  styleString.split(";").forEach((rule) => {
    if (!rule.trim()) return; // Skip empty rules
    const parts = rule.split(":");
    if (parts.length === 2) {
      const key = parts[0]?.trim(); // Use optional chaining and check
      const value = parts[1]?.trim(); // Use optional chaining and check
      if (key && value) {
        // Ensure both key and value are valid strings
        // Keep CSS key format (e.g., 'font-family')
        styleObj[key] = value;
      }
    }
  });
  return styleObj;
}

/**
 * Reconstructs a CSS style string from an object.
 *
 * @param styleObj An object representation (e.g., { color: "red", "font-size": "12px" })
 * @returns A CSS style string (e.g., "color: red; font-size: 12px;")
 */
export function reconstructStyleString(
  styleObj: Record<string, string>,
): string {
  return Object.entries(styleObj)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}
