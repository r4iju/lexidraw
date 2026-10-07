/// <reference types="bun" />
import { expect, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { createEditor } from "lexical";
import { act } from "react";
import { installDom, render } from "~/test/dom";
import { SettingsProvider } from "../../context/settings-context";
import VideoComponent from "./VideoComponent";

installDom("https://app.test/documents/1");

async function video(src: string) {
  return render(
    <LexicalComposer
      initialConfig={{
        namespace: "video-test",
        onError: (error) => {
          throw error;
        },
      }}
    >
      <SettingsProvider>
        <VideoComponent
          src={src}
          nodeKey="video"
          width="inherit"
          height="inherit"
          resizable
          caption={createEditor()}
          showCaption={false}
          figureWidth={undefined}
        />
      </SettingsProvider>
    </LexicalComposer>,
  );
}

test("a video that cannot be played says so and links to its file", async () => {
  const view = await video("https://cdn.example/missing.mp4");
  await act(async () => {
    document.querySelector("video")?.dispatchEvent(new window.Event("error"));
  });
  expect(document.body.textContent).toContain("This video can't be played");
  const open = [...document.querySelectorAll("a")].find(
    (link) => link.textContent === "Open video",
  );
  expect(open?.href).toBe("https://cdn.example/missing.mp4");
  await view.unmount();
});
