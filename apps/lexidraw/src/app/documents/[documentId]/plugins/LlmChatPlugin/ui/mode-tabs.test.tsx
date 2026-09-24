/// <reference types="bun" />
import { installDom, render } from "~/test/dom";

installDom();

import { afterEach, describe, expect, test } from "bun:test";
import type { ChatState } from "../llm-chat-context";

const { ChatDispatchCtx, ChatStateCtx } = await import("../llm-chat-context");
const { ModeTabs } = await import("./mode-tabs");

const state: ChatState = {
  messages: [],
  streaming: false,
  sidebarOpen: true,
  mode: "chat",
  streamingMessageId: null,
  maxAgentSteps: 5,
};

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  window.localStorage.clear();
});

async function tabs() {
  ({ unmount } = await render(
    <ChatStateCtx.Provider value={state}>
      <ChatDispatchCtx.Provider value={() => {}}>
        <ModeTabs />
      </ChatDispatchCtx.Provider>
    </ChatStateCtx.Provider>,
  ));
  return [...document.querySelectorAll('[role="tab"]')].map((tab) =>
    tab.textContent?.trim(),
  );
}

describe("AI assistant modes", () => {
  test("hide the Debug tab from people who are not developers", async () => {
    expect(await tabs()).toEqual(["Chat", "Agent", "Slide agent"]);
  });

  test("show the Debug tab once the developer flag is on", async () => {
    window.localStorage.setItem("lexidraw-developer", "on");
    expect(await tabs()).toContain("Debug");
  });
});
