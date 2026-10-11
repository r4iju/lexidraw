import { expect, test } from "bun:test";
import { installDom, render } from "~/test/dom";
import { ThemedThumbnail } from "./themed-thumbnail";
installDom();
test("private generated thumbnails request the authenticated entity URL directly in both themes", async () => {
  const url = "/api/generated-images/00000000-0000-4000-8000-000000000041";
  const view = await render(
    <ThemedThumbnail
      light={url}
      dark={url}
      alt="Saved thumbnail"
      sizes="100px"
      fallback={<span>No thumbnail</span>}
    />,
  );
  const images = [...document.querySelectorAll('img[alt="Saved thumbnail"]')];
  expect(images).toHaveLength(2);
  expect(images.map((image) => image.getAttribute("src"))).toEqual([url, url]);
  expect(images.every((image) => !image.hasAttribute("srcset"))).toBe(true);
  await view.unmount();
});
