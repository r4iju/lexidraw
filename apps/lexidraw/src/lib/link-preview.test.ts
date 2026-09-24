/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { linkPreview, SITE_PREVIEW } from "./link-preview";

describe("link previews", () => {
  test("a shared document previews with its title, text and thumbnail", () => {
    const preview = linkPreview({
      title: "Ninja Crispi · Top 5",
      entityType: "document",
      text: `Five recipes that come out crisp every time. ${"Filler words go here. ".repeat(20)}`,
      image: "https://blob.test/thumbnails/d1/light.webp",
    });
    expect(preview.openGraph?.title).toBe("Ninja Crispi · Top 5");
    expect(preview.description).toStartWith(
      "Five recipes that come out crisp every time.",
    );
    expect(preview.description?.length).toBeLessThanOrEqual(160);
    expect(preview.description).toEndWith("…");
    expect(preview.openGraph?.description).toBe(preview.description ?? "");
    expect(preview.openGraph?.images).toEqual([
      {
        url: "https://blob.test/thumbnails/d1/light.webp",
        width: 640,
        height: 480,
        alt: "Ninja Crispi · Top 5",
      },
    ]);
    expect(preview.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Ninja Crispi · Top 5",
    });
  });

  test("a file with no text or thumbnail says what it is and keeps the site image", () => {
    const preview = linkPreview({ title: "Flows", entityType: "drawing" });
    expect(preview.description).toBe("A drawing on Lexidraw.");
    expect(preview.openGraph?.images).toBeUndefined();
  });

  test("a document that opens with its own title doesn't repeat it", () => {
    const preview = linkPreview({
      title: "Launch plan",
      entityType: "document",
      text: "Launch plan Everything we need to ship.",
    });
    expect(preview.description).toBe("Everything we need to ship.");
  });

  test("the site preview describes Lexidraw, not a demo", () => {
    expect(SITE_PREVIEW.description).not.toMatch(/demo|excalidraw/i);
    expect(SITE_PREVIEW.openGraph?.siteName).toBe("Lexidraw");
  });
});
