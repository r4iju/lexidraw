/// <reference types="bun" />
import { installDom } from "~/test/dom";

installDom();

import { expect, test } from "bun:test";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { downloadScene } from "./download-scene";

test("a downloaded scene carries the files its images show", async () => {
  const files = {
    abc: {
      id: "abc",
      mimeType: "image/png",
      dataURL: "data:image/png;base64,AQID",
      created: 1,
    },
  };
  const excalidraw = {
    getSceneElements: () => [{ id: "i", type: "image", fileId: "abc" }],
    getAppState: () => ({ viewBackgroundColor: "#ffffff" }),
    getFiles: () => files,
  } as unknown as ExcalidrawImperativeAPI;
  let saved: Blob | undefined;
  const { createObjectURL, revokeObjectURL } = URL;
  const { click } = HTMLAnchorElement.prototype;
  // jsdom can't follow the download link.
  HTMLAnchorElement.prototype.click = () => {};
  URL.createObjectURL = (blob: Blob) => {
    saved = blob;
    return "blob:scene";
  };
  URL.revokeObjectURL = () => {};
  try {
    downloadScene(excalidraw, "Plan");
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    HTMLAnchorElement.prototype.click = click;
  }

  expect(JSON.parse(await (saved as Blob).text()).files).toEqual(files);
});
