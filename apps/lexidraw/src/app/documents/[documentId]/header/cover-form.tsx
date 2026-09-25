"use client";

import type { DocumentCover } from "@packages/lexical-nodes";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { IMAGE, type Upload } from "~/lib/media-upload";

const carriesFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files");

/**
 * Sets the document's cover from an image's address, or from a file: chosen
 * with Upload, pasted, or dropped on the form. The cover is set as soon as
 * its upload is done; a failed one says why and leaves the form as it was.
 */
export function CoverForm({
  onDone,
  upload,
}: {
  onDone: (cover: DocumentCover | null) => void;
  upload: Upload;
}) {
  const [src, setSrc] = useState("");
  /**
   * The upload under way, if any, and how far it is in percent; no progress
   * before its first report.
   */
  const [uploading, setUploading] = useState<{ progress?: number } | null>(
    null,
  );
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  /**
   * Once cancelled or gone, an upload still under way sets nothing: the blob
   * store's request outlives the form, and its progress and address arrive
   * after it.
   */
  const closed = useRef(false);
  // Opens and closes the gate for that request as the form mounts and goes.
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  const close = (cover: DocumentCover | null) => {
    closed.current = true;
    onDone(cover);
  };

  const send = async (file: File) => {
    if (uploading) return;
    setUploading({});
    const url = await upload(file, (progress) => {
      if (!closed.current) setUploading({ progress });
    });
    if (closed.current) return;
    setUploading(null);
    if (url) close({ src: url });
  };

  return (
    <form
      className="document-cover-form"
      data-over={over || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (uploading) return;
        close(src.trim() ? { src: src.trim() } : null);
      }}
      onPaste={(event) => {
        const file = [...event.clipboardData.files].find((candidate) =>
          candidate.type.startsWith("image/"),
        );
        if (!file) return;
        event.preventDefault();
        void send(file);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        const to = event.relatedTarget;
        if (!(to instanceof Node && event.currentTarget.contains(to)))
          setOver(false);
      }}
      onDrop={(event) => {
        const file = event.dataTransfer.files[0];
        setOver(false);
        if (!file) return;
        event.preventDefault();
        void send(file);
      }}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the form was opened to be filled
        autoFocus
        type="url"
        aria-label="Cover image address"
        placeholder="https://…/cover.jpg or drop an image"
        value={src}
        onChange={(event) => setSrc(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close(null);
        }}
      />
      <input
        ref={picker}
        type="file"
        accept={IMAGE.types.join(",")}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void send(file);
        }}
      />
      <button
        type="button"
        className="document-header-action"
        disabled={uploading !== null}
        onClick={() => picker.current?.click()}
      >
        Upload
      </button>
      <button
        type="submit"
        className="document-header-action"
        disabled={uploading !== null}
      >
        Set cover
      </button>
      <button
        type="button"
        className="document-header-action"
        onClick={() => close(null)}
      >
        Cancel
      </button>
      {uploading && (
        <span role="status" className="document-cover-progress">
          {uploading.progress === undefined
            ? "Uploading…"
            : `Uploading… ${uploading.progress}%`}
        </span>
      )}
    </form>
  );
}
