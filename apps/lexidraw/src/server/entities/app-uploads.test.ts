import { expect, test } from "bun:test";
import env from "@packages/env";
import { appUploadsIn } from "./app-uploads";

test("claims inline and nested caption pictures uploaded by their owner", () => {
  const owner = "native-picture-owner";
  const pathname = `${owner}-00000000-0000-0000-0000-000000000001.jpg`;
  const src = `${env.VERCEL_BLOB_STORAGE_HOST}/${pathname}`;
  const image = { type: "inline-image", src };
  const captionPath = `${owner}-00000000-0000-0000-0000-000000000002.jpg`;
  const captionURL = `${env.VERCEL_BLOB_STORAGE_HOST}/${captionPath}`;
  const elements = JSON.stringify({
    root: {
      children: [
        image,
        {
          type: "image",
          src: "https://example.com/external.jpg",
          caption: {
            editorState: {
              root: {
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "image", src: captionURL }],
                  },
                ],
              },
            },
          },
        },
      ],
    },
  });
  expect(appUploadsIn(elements, owner)).toEqual([
    { url: src, pathname },
    { url: captionURL, pathname: captionPath },
  ]);
  expect(appUploadsIn(elements, "someone-else")).toEqual([]);
});
