/// <reference types="bun" />
import { expect, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { act } from "react";
import { click, installDom, render } from "~/test/dom";
import YouTubeComponent from "./YouTubeComponent";

installDom("https://app.test/documents/1");

async function video(videoID: string) {
  return render(
    <LexicalComposer
      initialConfig={{
        namespace: "youtube-test",
        onError: (error) => {
          throw error;
        },
      }}
    >
      <YouTubeComponent
        className={{ base: "", focus: "" }}
        format={null}
        nodeKey="video"
        videoID={videoID}
      />
    </LexicalComposer>,
  );
}

/** The thumbnail arriving from YouTube at `width` pixels wide. */
async function thumbnailArrives(width: number) {
  const thumbnail = document.querySelector("img");
  if (!thumbnail) throw new Error("no thumbnail");
  Object.defineProperty(thumbnail, "naturalWidth", { value: width });
  await act(async () => {
    thumbnail.dispatchEvent(new window.Event("load"));
  });
}

const playButton = () =>
  document.querySelector<HTMLButtonElement>('button[aria-label="Play video"]');

test("a video is busy until its thumbnail arrives, then plays in place when asked", async () => {
  const view = await video("dQw4w9WgXcQ");
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(document.querySelector("img")?.getAttribute("src")).toContain(
    "/vi/dQw4w9WgXcQ/",
  );

  await thumbnailArrives(480);
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  expect(document.querySelector("iframe")).toBeNull();

  await click(playButton());
  const player = document.querySelector("iframe");
  expect(player?.src).toStartWith(
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  expect(player?.src).toContain("autoplay=1");
  await view.unmount();
});

test("a video YouTube has no thumbnail for says it is unavailable and links to it", async () => {
  const view = await video("xxxxxxxxxxx");
  // YouTube answers an id it does not know with a 120 by 90 placeholder.
  await thumbnailArrives(120);
  expect(document.body.textContent).toContain("This video is unavailable");
  expect(playButton()).toBeNull();
  const source = [...document.querySelectorAll("a")].find(
    (link) => link.textContent === "Open on YouTube",
  );
  expect(source?.href).toBe("https://www.youtube.com/watch?v=xxxxxxxxxxx");
  await view.unmount();
});

test("a video whose id names none says no video is linked, without asking YouTube", async () => {
  for (const id of ["", "fixture-unavailable"]) {
    const view = await video(id);
    expect(document.body.textContent).toContain("No video linked");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("a")).toBeNull();
    await view.unmount();
  }
});
