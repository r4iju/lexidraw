/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { button, click, installDom, render, type } from "~/test/dom";

installDom();
const { CoverForm } = await import("./cover-form");

type Cover = { src: string } | null;

/** An upload the test finishes, reporting progress along the way. */
function pendingUpload() {
  let finish: (url: string | null) => void = () => {};
  let report: ((percentage: number) => void) | undefined;
  const upload = mock(
    (_file: File, onProgress?: (percentage: number) => void) => {
      report = onProgress;
      return new Promise<string | null>((resolve) => {
        finish = resolve;
      });
    },
  );
  return {
    upload,
    progress: (percentage: number) => act(async () => report?.(percentage)),
    finish: (url: string | null) => act(async () => finish(url)),
  };
}

const image = () => new File(["png"], "cover.png", { type: "image/png" });

const form = () =>
  document.querySelector<HTMLFormElement>(".document-cover-form");
const fileInput = () =>
  document.querySelector<HTMLInputElement>('input[type="file"]');
const status = () => document.querySelector('[role="status"]')?.textContent;

async function choose(file: File) {
  const input = fileInput();
  if (!input) throw new Error("no file input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

/** Sends `name` to the form carrying `files`, as a paste or a drop would. */
async function send(name: "paste" | "drop", files: File[]) {
  const event = new window.Event(name, { bubbles: true, cancelable: true });
  const data = {
    files,
    types: files.length ? ["Files"] : ["text/plain"],
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
    getData: () => "",
  };
  Object.defineProperty(
    event,
    name === "paste" ? "clipboardData" : "dataTransfer",
    {
      value: data,
    },
  );
  await act(async () => {
    form()?.dispatchEvent(event);
  });
  return event;
}

describe("the cover form", () => {
  test("still sets a cover from an address", async () => {
    const onDone = mock((_cover: Cover) => {});
    const view = await render(
      <CoverForm onDone={onDone} upload={pendingUpload().upload} />,
    );
    const address = document.querySelector<HTMLInputElement>(
      'input[aria-label="Cover image address"]',
    );
    if (!address) throw new Error("no address field");
    await type(address, " https://example.test/cover.jpg ");
    await click(button("Set cover"));
    expect(onDone).toHaveBeenCalledWith({
      src: "https://example.test/cover.jpg",
    });
    await view.unmount();
  });

  test("Upload opens the picker for images", async () => {
    const view = await render(
      <CoverForm onDone={() => {}} upload={pendingUpload().upload} />,
    );
    const input = fileInput();
    expect(input?.accept).toContain("image/png");
    const opened = mock(() => {});
    input?.addEventListener("click", opened);
    await click(button("Upload"));
    expect(opened).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test("uploads a chosen image, shows how far it is, and sets it as the cover", async () => {
    const onDone = mock((_cover: Cover) => {});
    const pending = pendingUpload();
    const view = await render(
      <CoverForm onDone={onDone} upload={pending.upload} />,
    );
    const file = image();

    await choose(file);
    expect(pending.upload.mock.calls[0]?.[0]).toBe(file);
    expect(button("Set cover")?.disabled).toBe(true);
    expect(button("Upload")?.disabled).toBe(true);
    expect(status()).toBe("Uploading…");
    await pending.progress(40);
    expect(status()).toBe("Uploading… 40%");
    expect(onDone).not.toHaveBeenCalled();

    await pending.finish("https://blob.test/cover.png");
    expect(onDone).toHaveBeenCalledWith({ src: "https://blob.test/cover.png" });
    await view.unmount();
  });

  test("stays open, ready again, when the upload fails", async () => {
    const onDone = mock((_cover: Cover) => {});
    const pending = pendingUpload();
    const view = await render(
      <CoverForm onDone={onDone} upload={pending.upload} />,
    );

    await choose(image());
    await pending.finish(null);
    expect(onDone).not.toHaveBeenCalled();
    expect(button("Set cover")?.disabled).toBe(false);
    expect(button("Upload")?.disabled).toBe(false);
    expect(status()).toBeUndefined();
    await view.unmount();
  });

  test("uploads an image pasted into it", async () => {
    const onDone = mock((_cover: Cover) => {});
    const pending = pendingUpload();
    const view = await render(
      <CoverForm onDone={onDone} upload={pending.upload} />,
    );
    const file = image();

    const event = await send("paste", [file]);
    expect(event.defaultPrevented).toBe(true);
    expect(pending.upload.mock.calls[0]?.[0]).toBe(file);
    await pending.finish("https://blob.test/pasted.png");
    expect(onDone).toHaveBeenCalledWith({
      src: "https://blob.test/pasted.png",
    });
    await view.unmount();
  });

  test("leaves a pasted address to the field", async () => {
    const pending = pendingUpload();
    const view = await render(
      <CoverForm onDone={() => {}} upload={pending.upload} />,
    );
    const event = await send("paste", []);
    expect(event.defaultPrevented).toBe(false);
    expect(pending.upload).not.toHaveBeenCalled();
    await view.unmount();
  });

  test("uploads an image dropped on it", async () => {
    const onDone = mock((_cover: Cover) => {});
    const pending = pendingUpload();
    const view = await render(
      <CoverForm onDone={onDone} upload={pending.upload} />,
    );
    const file = image();

    const event = await send("drop", [file]);
    expect(event.defaultPrevented).toBe(true);
    expect(pending.upload.mock.calls[0]?.[0]).toBe(file);
    await pending.finish("https://blob.test/dropped.png");
    expect(onDone).toHaveBeenCalledWith({
      src: "https://blob.test/dropped.png",
    });
    await view.unmount();
  });

  test("does not set a cover whose upload finishes after Cancel", async () => {
    const onDone = mock((_cover: Cover) => {});
    const pending = pendingUpload();
    const view = await render(
      <CoverForm onDone={onDone} upload={pending.upload} />,
    );

    await choose(image());
    await click(button("Cancel"));
    await pending.finish("https://blob.test/late.png");
    expect(onDone.mock.calls).toEqual([[null]]);
    await view.unmount();
  });
});
