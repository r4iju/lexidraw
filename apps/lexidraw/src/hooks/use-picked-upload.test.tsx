/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { installDom, render } from "~/test/dom";

installDom();
const { usePickedUpload } = await import("./use-picked-upload");

/** Uploads the test finishes one by one, in any order. */
function uploads() {
  const pending = new Map<string, (url: string | null) => void>();
  const upload = mock(
    (file: File) =>
      new Promise<string | null>((resolve) => pending.set(file.name, resolve)),
  );
  return {
    upload,
    finish: (name: string, url: string | null) =>
      act(async () => pending.get(name)?.(url)),
  };
}

let picked: ReturnType<typeof usePickedUpload> | undefined;
function Picker({
  upload,
}: {
  upload: (file: File) => Promise<string | null>;
}) {
  picked = usePickedUpload(upload);
  return null;
}

const files = (...names: string[]) =>
  names.map((name) => new File(["x"], name, { type: "image/png" }));
const pick = (...names: string[]) =>
  act(async () => picked?.pick(files(...names)));

describe("a picked file's upload", () => {
  test("is pending until it is up, then gives its address", async () => {
    const { upload, finish } = uploads();
    const view = await render(<Picker upload={upload} />);
    expect(picked).toMatchObject({ src: "", pending: false });

    await pick("a.png");
    expect(picked).toMatchObject({ src: "", pending: true });
    await finish("a.png", "https://blob.test/a.png");
    expect(picked).toMatchObject({
      src: "https://blob.test/a.png",
      pending: false,
    });
    await view.unmount();
  });

  test("gives nothing when the upload fails", async () => {
    const { upload, finish } = uploads();
    const view = await render(<Picker upload={upload} />);
    await pick("a.png");
    await finish("a.png", null);
    expect(picked).toMatchObject({ src: "", pending: false });
    await view.unmount();
  });

  test("is the latest pick's: a slower earlier one never replaces it", async () => {
    const { upload, finish } = uploads();
    const view = await render(<Picker upload={upload} />);
    await pick("slow.png");
    await pick("fast.png");
    await finish("fast.png", "https://blob.test/fast.png");
    expect(picked).toMatchObject({
      src: "https://blob.test/fast.png",
      pending: false,
    });
    await finish("slow.png", "https://blob.test/slow.png");
    expect(picked?.src).toBe("https://blob.test/fast.png");
    await view.unmount();
  });

  test("forgets the last address while a new pick goes up", async () => {
    const { upload, finish } = uploads();
    const view = await render(<Picker upload={upload} />);
    await pick("a.png");
    await finish("a.png", "https://blob.test/a.png");
    await pick("b.png");
    expect(picked).toMatchObject({ src: "", pending: true });
    await view.unmount();
  });

  test("ignores an empty pick", async () => {
    const { upload } = uploads();
    const view = await render(<Picker upload={upload} />);
    await act(async () => picked?.pick(null));
    expect(upload).not.toHaveBeenCalled();
    await view.unmount();
  });
});
