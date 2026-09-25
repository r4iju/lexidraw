"use client";

import type { DocumentCover } from "@packages/lexical-nodes";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { IMAGE_TYPES, type UploadImage } from "~/lib/image-upload";

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
  upload: UploadImage;
}) {
  const [src, setSrc] = useState("");
  /** How far the upload is, in percent; undefined before its first report. */
  const [progress, setProgress] = useState<number | undefined>();
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  /** Once cancelled or gone, an upload still under way sets nothing. */
  const closed = useRef(false);
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
    setUploading(true);
    setProgress(undefined);
    const url = await upload(file, (percentage) => {
      if (!closed.current) setProgress(percentage);
    });
    if (closed.current) return;
    setUploading(false);
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
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
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
        accept={IMAGE_TYPES.join(",")}
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
        disabled={uploading}
        onClick={() => picker.current?.click()}
      >
        Upload
      </button>
      <button
        type="submit"
        className="document-header-action"
        disabled={uploading}
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
          {progress === undefined ? "Uploading…" : `Uploading… ${progress}%`}
        </span>
      )}
    </form>
  );
}
