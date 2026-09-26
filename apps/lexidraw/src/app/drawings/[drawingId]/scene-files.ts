import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { readDrawingFile } from "~/lib/drawing-files";

/** A file the drawing stores, as `drawings.files` lists it. */
export type StoredFile = {
  id: string;
  mimeType: string;
  url: string;
  created: number;
};

/** The server will not store a file, and sending it again changes nothing. */
export class FileRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRefused";
  }
}

type Store = {
  list: () => Promise<StoredFile[]>;
  fetch: (file: StoredFile) => Promise<BinaryFileData>;
  /** Throws {@link FileRefused} when the server refuses the file itself. */
  upload: (file: BinaryFileData) => Promise<void>;
};

type Editor = {
  addFiles: (files: BinaryFileData[]) => void;
  /** Sets the status of the image elements showing each file. */
  settle: (statuses: [fileId: string, status: "saved" | "error"][]) => void;
  /** Says why a file was not stored; called once per file. */
  failed: (fileId: string, reason: string) => void;
};

type Scene = { elements: readonly ExcalidrawElement[]; files: BinaryFiles };

/**
 * The files an open drawing's image elements show, kept in step with the
 * drawing's file store: the stored ones are loaded when it opens, one an
 * image shows that this editor lacks is fetched once it is stored, and one
 * this editor added is sent, once, and its images marked saved so the next
 * save tells everyone else it is there to fetch.
 *
 * Nothing is sent until the listing says what is stored already, and files
 * go one at a time, because each fills most of a request body alone.
 */
export class SceneFiles {
  /** On the server, as listed or since sent. */
  private readonly stored = new Set<string>();
  /** In the editor, or on the way there. */
  private readonly loaded = new Set<string>();
  /** Files looked for in the store, by id and the status that sent us. */
  private readonly sought = new Set<string>();
  /** Refused for good, so never sent again. */
  private readonly refused = new Set<string>();
  /** Failures already said, so a retry that fails too stays quiet. */
  private readonly reported = new Set<string>();
  private readonly queue = new Map<string, BinaryFileData>();
  private sending = false;
  private listing: Promise<void> | null = null;
  private ready = false;
  private closed = false;
  private latest: Scene | null = null;

  constructor(
    private readonly store: Store,
    private readonly editor: Editor,
    private readonly options: { canUpload: boolean },
  ) {}

  /** Loads what the drawing stores; changes before it lands wait for it. */
  async open(): Promise<void> {
    await this.relist();
    this.ready = true;
    if (this.latest) this.changed(this.latest.elements, this.latest.files);
  }

  /** Stops acting on answers that arrive after the editor is gone. */
  close(): void {
    this.closed = true;
  }

  /** Excalidraw reported the scene. */
  changed(elements: readonly ExcalidrawElement[], files: BinaryFiles): void {
    if (this.closed) return;
    if (!this.ready) {
      this.latest = { elements, files };
      return;
    }
    let lacking = false;
    for (const element of elements) {
      if (element.type !== "image" || element.isDeleted || !element.fileId) {
        continue;
      }
      const id = element.fileId;
      const held = files[id];
      if (held) {
        this.loaded.add(id);
        if (this.options.canUpload) this.enqueue(held);
        continue;
      }
      const seeking = `${id}:${element.status}`;
      if (this.loaded.has(id) || this.sought.has(seeking)) continue;
      this.sought.add(seeking);
      lacking = true;
    }
    if (lacking) void this.relist();
    void this.send();
  }

  private enqueue(file: BinaryFileData): void {
    if (
      this.stored.has(file.id) ||
      this.refused.has(file.id) ||
      this.queue.has(file.id)
    ) {
      return;
    }
    this.queue.set(file.id, file);
  }

  private async send(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      for (const [id, file] of this.queue) {
        if (this.closed) return;
        try {
          const checked = readDrawingFile(file.mimeType, file.dataURL);
          if (!checked.ok) throw new FileRefused(checked.reason);
          await this.store.upload(file);
          this.stored.add(id);
          this.editor.settle([[id, "saved"]]);
        } catch (error) {
          if (error instanceof FileRefused) {
            this.refused.add(id);
            this.editor.settle([[id, "error"]]);
          }
          this.report(id, error);
        } finally {
          this.queue.delete(id);
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private report(id: string, error: unknown): void {
    if (this.closed || this.reported.has(id)) return;
    this.reported.add(id);
    this.editor.failed(
      id,
      error instanceof Error ? error.message : "The image was not stored",
    );
  }

  /** Lists the store and loads what this editor lacks; one listing at a time. */
  private relist(): Promise<void> {
    this.listing ??= this.load().finally(() => {
      this.listing = null;
    });
    return this.listing;
  }

  private async load(): Promise<void> {
    let listed: StoredFile[];
    try {
      listed = await this.store.list();
    } catch (error) {
      console.error("drawing files not listed", error);
      return;
    }
    const missing = listed.filter((file) => {
      this.stored.add(file.id);
      return !this.loaded.has(file.id);
    });
    for (const file of missing) this.loaded.add(file.id);
    const fetched = await Promise.all(
      missing.map((file) =>
        this.store.fetch(file).catch((error: unknown) => {
          this.loaded.delete(file.id);
          console.error("drawing file not fetched", file.id, error);
          return null;
        }),
      ),
    );
    const files = fetched.filter((file) => file !== null);
    if (!this.closed && files.length > 0) this.editor.addFiles(files);
  }
}
