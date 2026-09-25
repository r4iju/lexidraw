/// <reference types="bun" />
import { describe, expect, mock, spyOn, test } from "bun:test";
import { toast } from "sonner";
import {
  IMAGE,
  insertUploads,
  uploadGeneratedImage,
  uploadMedia,
  VIDEO,
} from "./media-upload";

/** The toasts shown since `before`, as their titles and descriptions. */
function toastsSince(before: number) {
  return toast
    .getHistory()
    .slice(before)
    .map((shown) => ({
      title: "title" in shown ? shown.title : undefined,
      description: "description" in shown ? shown.description : undefined,
    }));
}

function sender(url = "https://blob.test/cover.png") {
  return mock(
    async (
      _pathname: string,
      _file: File,
      options: { onUploadProgress?: (event: { percentage: number }) => void },
    ) => {
      options.onUploadProgress?.({ percentage: 40 });
      options.onUploadProgress?.({ percentage: 100 });
      return { url };
    },
  );
}

const signer = () =>
  mock(async (_contentType: string) => ({
    token: "token-1",
    pathname: "entity-1/cover.png",
  }));

describe("uploading an image", () => {
  test("sends an allowed image and answers where it is", async () => {
    const sign = signer();
    const send = sender();
    const progress: number[] = [];
    const file = new File(["png"], "cover.png", { type: "image/png" });

    const url = await uploadMedia(file, IMAGE, {
      sign,
      send,
      onProgress: (percentage) => progress.push(percentage),
    });

    expect(url).toBe("https://blob.test/cover.png");
    expect(sign).toHaveBeenCalledWith("image/png");
    expect(send.mock.calls[0]?.[0]).toBe("entity-1/cover.png");
    expect(send.mock.calls[0]?.[1]).toBe(file);
    expect(send.mock.calls[0]?.[2]).toMatchObject({
      access: "public",
      contentType: "image/png",
      token: "token-1",
    });
    expect(progress).toEqual([40, 100]);
  });

  test("refuses a file that is not an allowed image, before sending anything", async () => {
    const before = toast.getHistory().length;
    const sign = signer();
    const send = sender();

    const url = await uploadMedia(
      new File(["gif"], "cover.gif", { type: "image/gif" }),
      IMAGE,
      { sign, send },
    );

    expect(url).toBeNull();
    expect(sign).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(toastsSince(before)).toEqual([
      {
        title: "Unsupported image type",
        description: "Allowed: PNG, JPEG, SVG, WEBP, AVIF.",
      },
    ]);
  });

  test("refuses an image over 10MB, before sending anything", async () => {
    const before = toast.getHistory().length;
    const sign = signer();
    const send = sender();

    const url = await uploadMedia(
      new File([new Uint8Array(IMAGE.maxBytes + 1)], "huge.png", {
        type: "image/png",
      }),
      IMAGE,
      { sign, send },
    );

    expect(url).toBeNull();
    expect(sign).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(toastsSince(before)).toEqual([
      { title: "Image too large", description: "Max size is 10MB." },
    ]);
  });

  test("says why when the upload fails", async () => {
    const before = toast.getHistory().length;
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const sign = mock(async (_contentType: string) => {
      throw new Error("You cannot edit this document");
    });

    const url = await uploadMedia(
      new File(["png"], "cover.png", { type: "image/png" }),
      IMAGE,
      { sign, send: sender() },
    );

    expect(url).toBeNull();
    expect(toastsSince(before)).toEqual([
      {
        title: "Image Upload Failed",
        description: "You cannot edit this document",
      },
    ]);
    logged.mockRestore();
  });
});

/** A file that says it is `size` bytes, without holding them. */
function sized(name: string, type: string, size: number) {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("uploading anything", () => {
  test("says why when sending fails, after the upload was signed", async () => {
    const before = toast.getHistory().length;
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const send = mock(async () => {
      throw new Error("Network down");
    });

    const url = await uploadMedia(
      new File(["mp4"], "clip.mp4", { type: "video/mp4" }),
      VIDEO,
      { sign: signer(), send },
    );

    expect(url).toBeNull();
    expect(toastsSince(before)).toEqual([
      { title: "Video Upload Failed", description: "Network down" },
    ]);
    logged.mockRestore();
  });

  test("refuses a video of a type or size it does not take", async () => {
    const before = toast.getHistory().length;
    const sign = signer();
    for (const file of [
      sized("clip.mov", "video/quicktime", 10),
      sized("long.mp4", "video/mp4", VIDEO.maxBytes + 1),
    ])
      expect(
        await uploadMedia(file, VIDEO, { sign, send: sender() }),
      ).toBeNull();
    expect(sign).not.toHaveBeenCalled();
    expect(toastsSince(before)).toEqual([
      {
        title: "Unsupported video type",
        description: "Allowed: MP4, WEBM, OGG.",
      },
      { title: "Video too large", description: "Max size is 100MB." },
    ]);
  });

  test("sends a video with the type it was signed for", async () => {
    const sign = signer();
    const url = await uploadMedia(
      new File(["webm"], "clip.webm", { type: "video/webm" }),
      VIDEO,
      { sign, send: sender("https://blob.test/clip.webm") },
    );
    expect(url).toBe("https://blob.test/clip.webm");
    expect(sign).toHaveBeenCalledWith("video/webm");
  });
});

/** An upload that sends `ok` files and refuses the rest, as `uploadMedia` does. */
function uploadOnly(ok: string[]) {
  return async (file: File) => {
    if (ok.includes(file.name)) return `https://blob.test/${file.name}`;
    toast.error("Image Upload Failed", { description: file.name });
    return null;
  };
}

const image = (name: string) => new File(["png"], name, { type: "image/png" });

describe("dropping or pasting images", () => {
  test("says the image went in only once it has", async () => {
    const before = toast.getHistory().length;
    const inserted: string[] = [];
    await insertUploads([image("a.png")], uploadOnly(["a.png"]), (url) =>
      inserted.push(url),
    );
    expect(inserted).toEqual(["https://blob.test/a.png"]);
    expect(toastsSince(before).map((shown) => shown.title)).toEqual([
      "Image inserted",
    ]);
  });

  test("a failed upload shows the failure, not that it was inserted", async () => {
    const before = toast.getHistory().length;
    const insert = mock(() => {});
    await insertUploads([image("a.png")], uploadOnly([]), insert);
    expect(insert).not.toHaveBeenCalled();
    expect(toastsSince(before).map((shown) => shown.title)).toEqual([
      "Image Upload Failed",
    ]);
  });

  test("of several, counts the ones that went in", async () => {
    const before = toast.getHistory().length;
    await insertUploads(
      [image("a.png"), image("b.png"), image("c.png")],
      uploadOnly(["a.png", "c.png"]),
      () => {},
    );
    expect(toastsSince(before).map((shown) => shown.title)).toEqual([
      "Image Upload Failed",
      "Inserted 2 of 3 images",
    ]);
  });
});

describe("uploading a generated image", () => {
  const transport = () => ({ sign: signer(), send: sender() });

  test("names the file for the type the model sent", async () => {
    const { sign, send } = transport();
    await uploadGeneratedImage(
      new Uint8Array([1, 2, 3]),
      "image/jpeg",
      "a red fox",
      (file) => uploadMedia(file, IMAGE, { sign, send }),
    );
    const sent = send.mock.calls[0]?.[1] as File;
    expect(sent.name).toMatch(/^a_red_fox_.+\.jpg$/);
    expect(sent.type).toBe("image/jpeg");
  });

  test("says it is uploading only after the type is checked", async () => {
    const before = toast.getHistory().length;
    const { sign, send } = transport();
    const url = await uploadGeneratedImage(
      new Uint8Array([1, 2, 3]),
      "image/gif",
      "a red fox",
      (file) => uploadMedia(file, IMAGE, { sign, send }),
    );
    expect(url).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(toastsSince(before).map((shown) => shown.title)).toEqual([
      "Unsupported image type",
    ]);
  });
});
