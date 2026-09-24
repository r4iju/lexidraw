/**
 * A model id as people say it: "gemini-3-pro-preview" is Gemini 3 Pro,
 * "gpt-5-mini" is GPT-5 mini. Release stages are dropped; the id is the
 * fallback for anything unfamiliar.
 */
export function modelLabel(modelId: string) {
  const parts = modelId
    .split("-")
    .filter((part) => !/^(preview|latest|exp|\d{4,})$/.test(part));
  const [family, version, ...rest] = parts;
  if (family === "gpt" && version) {
    return [`GPT-${version}`, ...rest].join(" ");
  }
  if (family === "gemini") {
    return parts
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return modelId;
}
