import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingFeatures } from "./landing-features";

/** Each picture on the landing page, as the name of the file it shows. */
function pictures() {
  const html = renderToStaticMarkup(<LandingFeatures />);
  return [...html.matchAll(/<img [^>]*>/g)].map(([tag]) => ({
    file: tag.match(/landing(?:\/|%2F)([\w-]+)\.webp/)?.[1],
    lazy: tag.includes('loading="lazy"'),
    first: tag.includes('fetchPriority="high"'),
  }));
}

describe("the landing page's pictures", () => {
  test("ask for the first picture before anything else", () => {
    expect(
      pictures()
        .filter((p) => p.first)
        .map((p) => p.file),
    ).toEqual(["document-light", "document-dark"]);
  });

  test("wait to be shown, so the other theme's copy never downloads", () => {
    expect(pictures().every((p) => p.lazy)).toBe(true);
  });
});
