import { expect, test, spyOn } from "bun:test";
import { GET } from "./route";

test("custom fonts request real italic and bold, with a normal-only fallback", async () => {
  const urls: string[] = [];
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response(
          urls.length === 1
            ? "Unsupported axes"
            : "@font-face { font-family: Example; }",
          { status: urls.length === 1 ? 400 : 200 },
        );
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const response = await GET(
      new Request("http://localhost:3025/api/fonts?family=Open%20Sans"),
    );
    expect(response.status).toBe(200);
    expect(urls[0]).toContain(
      "family=Open+Sans:ital,wght@0,400;0,700;1,400;1,700",
    );
    expect(urls[0]).toContain("display=swap");
    expect(urls[1]).toContain("family=Open+Sans:wght@400;700");
    expect(await response.text()).toContain("@font-face");
  } finally {
    fetcher.mockRestore();
  }
});
