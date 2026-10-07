/// <reference types="bun" />
import { afterEach, expect, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { act } from "react";
import { installDom, render } from "~/test/dom";
import TweetComponent from "./TweetComponent";

installDom("https://app.test/documents/1");

/** X's widget script, as it is once loaded: `createTweet` answering as given. */
function widgets(createTweet: (id: string, into: HTMLElement) => unknown) {
  (window as unknown as { twttr: unknown }).twttr = {
    widgets: { createTweet },
  };
}

const realSetTimeout = globalThis.setTimeout;

/**
 * Holds back timers of a second or more, the waits the block itself makes,
 * until `elapse` runs them; shorter ones, React's own, run as usual.
 */
function holdLongTimers() {
  const held: { ms: number; run: () => void }[] = [];
  globalThis.setTimeout = ((run: () => void, ms = 0, ...rest: unknown[]) => {
    if (ms < 1000) return realSetTimeout(run, ms, ...rest);
    held.push({ ms, run });
    return 0;
  }) as typeof setTimeout;
  return {
    elapse(ms: number) {
      for (const timer of held.splice(0))
        if (timer.ms <= ms) timer.run();
        else held.push(timer);
    },
  };
}

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
  delete (window as unknown as { twttr?: unknown }).twttr;
});

async function post(tweetID: string) {
  const view = await render(
    <LexicalComposer
      initialConfig={{
        namespace: "tweet-test",
        onError: (error) => {
          throw error;
        },
      }}
    >
      <TweetComponent
        className={{ base: "", focus: "" }}
        format={null}
        nodeKey="post"
        tweetID={tweetID}
      />
    </LexicalComposer>,
  );
  await act(async () => {});
  return view;
}

const sourceLink = () =>
  [...document.querySelectorAll("a")].find(
    (link) => link.textContent === "Open on X",
  );

test("a post is busy while X draws it", async () => {
  widgets((_id, into) => {
    into.append(document.createElement("iframe"));
    return new Promise(() => {});
  });
  const view = await post("20");
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  await view.unmount();
});

test("a post X has nothing for says it is unavailable and links to it", async () => {
  // X's widget resolves without an element for a deleted or unknown post.
  widgets(() => Promise.resolve(undefined));
  const view = await post("1453114034689441795");
  expect(document.body.textContent).toContain("This post is unavailable");
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  expect(sourceLink()?.href).toBe(
    "https://x.com/i/web/status/1453114034689441795",
  );
  await view.unmount();
});

test("a post X never answers for stops waiting and says it is unavailable", async () => {
  const clock = holdLongTimers();
  widgets(() => new Promise(() => {}));
  const view = await post("20");
  expect(document.body.textContent).not.toContain("This post is unavailable");
  await act(async () => {
    clock.elapse(14_000);
  });
  expect(document.body.textContent).not.toContain("This post is unavailable");
  await act(async () => {
    clock.elapse(15_000);
  });
  expect(document.body.textContent).toContain("This post is unavailable");
  await view.unmount();
});

test("a post whose id names none says no post is linked, without asking X", async () => {
  let asked = false;
  widgets(() => {
    asked = true;
    return new Promise(() => {});
  });
  for (const id of ["", "abc"]) {
    const view = await post(id);
    expect(document.body.textContent).toContain("No post linked");
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.querySelector("a")).toBeNull();
    await view.unmount();
  }
  expect(asked).toBe(false);
});
