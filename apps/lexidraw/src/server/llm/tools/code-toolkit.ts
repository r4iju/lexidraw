/**
 * Generates a minimal ESM toolkit module that calls the app's tRPC sandbox routes
 * using a short-lived JWT. Intended to be written inside the sandbox as /tmp/toolkit.mjs.
 */
export function generateToolkitModuleSource(params: {
  baseUrl: string;
  jwt: string;
}): string {
  const { baseUrl, jwt } = params;
  // inline literals to avoid relying on sandbox env
  const b = JSON.stringify(baseUrl.replace(/\/+$/, ""));
  const t = JSON.stringify(jwt);
  return `
export async function buildTools() {
  const baseUrl = ${b};
  const jwt = ${t};

  async function trpcCall(path, input, method = "POST") {
    const url = baseUrl + "/api/trpc/" + path;
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        "x-sandbox-auth-jwt": jwt
      },
      body: method === "GET" ? undefined : JSON.stringify({ input })
    });
    if (!res.ok) {
      let reason = "";
      try {
        const j = await res.json();
        reason = j?.message || "";
      } catch {
        reason = (await res.text()).slice(0, 300);
      }
      throw new Error("tRPC call failed: " + path + " " + res.status + (reason ? " - " + reason : ""));
    }
    return await res.json();
  }

  const tools = {
    web: {
      async search(query, opts) {
        const input = { query, ...(opts || {}) };
        const data = await trpcCall("sandbox.search", input, "POST");
        return data;
      },
      async fetchArticle(url, opts) {
        const input = { url, ...(opts || {}) };
        const data = await trpcCall("sandbox.fetchArticle", input, "POST");
        return data;
      }
    }
  };
  return tools;
}
`.trim();
}



