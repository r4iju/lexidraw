import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingFeatures } from "./landing-features";

const file = (tag: string) => tag.match(/landing(?:\/|%2F)([\w-]+)\.webp/)?.[1];

/** Each picture on the landing page, as the name of the file it shows. */
function pictures() {
  const html = renderToStaticMarkup(<LandingFeatures />);
  return {
    images: [...html.matchAll(/<img [^>]*>/g)].map(([tag]) => ({
      file: file(tag),
      lazy: tag.includes('loading="lazy"'),
      first: tag.includes('fetchPriority="high"'),
    })),
    darkSystem: [
      ...html.matchAll(
        /<source [^>]*media="\(prefers-color-scheme: dark\)"[^>]*>/g,
      ),
    ].map(([tag]) => file(tag)),
  };
}

describe("the landing page's pictures", () => {
  test("ask for the first picture at once, in the system's theme", () => {
    const { images, darkSystem } = pictures();
    const first = images.filter((p) => p.first);
    expect(first).toEqual([
      { file: "document-light", lazy: false, first: true },
    ]);
    expect(darkSystem).toEqual(["document-dark"]);
  });

  test("wait to be shown otherwise, so the other theme's copy never downloads", () => {
    const { images } = pictures();
    expect(images.filter((p) => !p.first).every((p) => p.lazy)).toBe(true);
  });
});
