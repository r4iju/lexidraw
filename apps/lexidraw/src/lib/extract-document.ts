import "server-only";

export type ExtractedDocument = {
  title: string;
  contentText: string;
  mimeType: string;
};

function inferMimeType(url: string, fallback: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".txt")) return "text/plain";
  return fallback;
}

export async function extractDocumentFromUrl(
  url: string,
): Promise<ExtractedDocument> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch document: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const contentTypeHeader =
    res.headers.get("content-type") || "application/octet-stream";
  const mimeType = inferMimeType(
    url,
    contentTypeHeader.split(";")[0] || "application/octet-stream",
  );
  const title = url.split("/").pop() ?? "document";

  if (mimeType === "application/pdf") {
    try {
      const mod = (await import("pdf-parse")) as unknown as {
        default: (buf: Buffer) => Promise<{ text?: unknown }>;
      };
      const parsed = await mod.default(buffer);
      const text = String(parsed.text ?? "").trim();
      return { title, contentText: text, mimeType };
    } catch {
      throw new Error("PDF extraction requires 'pdf-parse' to be installed.");
    }
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    try {
      const mammoth = (await import("mammoth")) as unknown as {
        extractRawText: (opts: {
          buffer: Buffer;
        }) => Promise<{ value?: unknown }>;
      };
      const result = await mammoth.extractRawText({ buffer });
      const text = String(result.value ?? "").trim();
      return { title, contentText: text, mimeType };
    } catch {
      throw new Error("DOCX extraction requires 'mammoth' to be installed.");
    }
  }

  if (mimeType.startsWith("text/")) {
    const text = buffer.toString("utf8");
    return { title, contentText: text, mimeType };
  }

  throw new Error(`Unsupported document type: ${mimeType}`);
}
