import { z } from "zod";
import { CredentialFingerprints } from "../byok/session";
import { ImageArtifact as ArtifactSchema } from "./contracts";
import type { SaveReceipt } from "../open-entity-sync";
import type { PowerPreference } from "~/lib/byok/preference";
import type { createByokSession } from "~/lib/byok/session";
import {
  IMAGE_UNAVAILABLE,
  ImageInput,
  validateImage,
  type ImageArtifact,
} from "./contracts";
export type ImageAvailability = {
  available: boolean;
  maximum: number;
  fixture: boolean;
  reason?: string;
};
type Completed = { image: ImageArtifact; uploadId: string; prompt: string };
export type ImageState =
  | { kind: "idle" }
  | { kind: "unavailable" | "failed"; message: string }
  | {
      kind: "quote";
      prompt: string;
      operationId: string;
      maximum: number;
      fixture: boolean;
    }
  | { kind: "uncertain"; key: string; prompt: string; source: "pro" | "byok" }
  | { kind: "generating" }
  | ({ kind: "completed" | "saving" | "sync_failed" } & Completed)
  | ({ kind: "saved"; url: string } & Completed);
export type ImagePorts = {
  source: () => PowerPreference;
  availability: () => ImageAvailability;
  byok: ReturnType<typeof createByokSession>;
  pro: (input: {
    idempotencyKey: string;
    prompt: string;
    acceptedMaximum: number;
  }) => Promise<ImageArtifact>;
  readPro?: (key: string) => Promise<ImageArtifact | null>;
  save: (uploadId: string, image: ImageArtifact) => Promise<string>;
};
const unavailablePorts: ImagePorts = {
  source: () => ({ mode: "local" }),
  availability: () => ({ available: false, maximum: 0, fixture: false }),
  get byok(): ImagePorts["byok"] {
    throw new Error(IMAGE_UNAVAILABLE);
  },
  pro: async () => {
    throw new Error(IMAGE_UNAVAILABLE);
  },
  save: async () => {
    throw new Error(IMAGE_UNAVAILABLE);
  },
};
export type ImageRetention = {
  owner: string;
  load: () => Promise<string | null>;
  save: (value: string, expected: string | null) => Promise<boolean>;
  clear: (expected: string) => Promise<void>;
};
const RetainedImage = z.strictObject({
  version: z.literal(1),
  owner: z.string().min(1).max(4096),
  fingerprints: CredentialFingerprints.default([]),
  image: ArtifactSchema,
  uploadId: z.uuid(),
  prompt: z.string().min(1).max(1500),
  url: z.url().optional(),
});
const PendingImage = z.strictObject({
  version: z.literal(1),
  owner: z.string().min(1).max(4096),
  fingerprints: CredentialFingerprints.default([]),
  key: z.uuid(),
  prompt: z.string().min(1).max(1500),
  source: z.enum(["pro", "byok"]),
});
function imageCount(node: unknown, url: string): number {
  if (!node || typeof node !== "object") return 0;
  const value = node as { type?: unknown; src?: unknown; children?: unknown };
  return (
    (value.type === "image" && value.src === url ? 1 : 0) +
    (Array.isArray(value.children)
      ? value.children.reduce(
          (n: number, child: unknown) => n + imageCount(child, url),
          0,
        )
      : 0)
  );
}
export class ImageFlow {
  private current: ImageState = { kind: "idle" };
  private retained: string | null = null;
  private restored?: Promise<void>;
  private ended = false;
  private quarantined = false;
  private intent = 0;
  private listeners = new Set<() => void>();
  constructor(
    private ports: ImagePorts = unavailablePorts,
    private retention?: ImageRetention,
  ) {}
  activate() {
    this.ended = false;
    this.intent++;
    this.restored = undefined;
  }
  end() {
    this.ended = true;
    this.intent++;
  }
  restore() {
    const intent = this.intent;
    if (this.restored) return this.restored;
    this.restored = (async () => {
      if (!this.retention) return;
      try {
        const raw = await this.retention.load();
        if (this.ended || intent !== this.intent || !raw) return;
        this.retained = raw;
        const parsed = JSON.parse(raw);
        const checkpoint = z.union([PendingImage, RetainedImage]).parse(parsed);
        this.ports.byok.restoreFingerprints(checkpoint.fingerprints);
        this.ports.byok.assertSafe(raw);
        const pending = PendingImage.safeParse(parsed);
        if (pending.success) {
          if (pending.data.owner !== this.retention.owner)
            throw new Error("Image owner mismatch");
          this.set({
            kind: "uncertain",
            key: pending.data.key,
            prompt: pending.data.prompt,
            source: pending.data.source,
          });
          return;
        }
        const value = RetainedImage.parse(parsed);
        if (value.owner !== this.retention.owner)
          throw new Error("Image owner mismatch");
        const image = validateImage(
          value.image,
          this.ports.byok.assertSafe,
        ).image;
        this.set(
          value.url
            ? {
                kind: "saved",
                image,
                uploadId: value.uploadId,
                prompt: value.prompt,
                url: value.url,
              }
            : {
                kind: "completed",
                image,
                uploadId: value.uploadId,
                prompt: value.prompt,
              },
        );
      } catch {
        this.quarantined = true;
        this.set({
          kind: "failed",
          message: "Local image quarantined. New generation is blocked.",
        });
      }
    })();
    return this.restored;
  }
  private async retain(state: Completed & { url?: string }) {
    if (!this.retention) return;
    const value = JSON.stringify(
      RetainedImage.parse({
        version: 1,
        owner: this.retention.owner,
        fingerprints: this.ports.byok.fingerprints(),
        image: state.image,
        prompt: state.prompt,
        uploadId: state.uploadId,
        ...(state.url ? { url: state.url } : {}),
      }),
    );
    this.ports.byok.assertSafe(value);
    if (!(await this.retention.save(value, this.retained)))
      throw new Error("Image retention changed or unavailable");
    this.retained = value;
  }
  private async pending(key: string, prompt: string, source: "pro" | "byok") {
    if (!this.retention) return;
    const raw = JSON.stringify(
      PendingImage.parse({
        version: 1,
        owner: this.retention.owner,
        fingerprints: this.ports.byok.fingerprints(),
        key,
        prompt,
        source,
      }),
    );
    this.ports.byok.assertSafe(raw);
    if (!(await this.retention.save(raw, this.retained)))
      throw new Error("Cannot retain image admission");
    this.retained = raw;
  }
  async recover() {
    await this.restore();
    const state = this.current;
    if (
      this.ended ||
      state.kind !== "uncertain" ||
      state.source !== "pro" ||
      !this.ports.readPro
    )
      return;
    const intent = this.intent;
    try {
      const image = await this.ports.readPro(state.key);
      if (!this.ended && intent === this.intent && image)
        await this.complete(image, state.prompt);
    } catch {
      /* An owned read preserves uncertainty and cannot dispatch. */
    }
  }
  async acknowledge(receipt: SaveReceipt) {
    const state = this.current;
    if (this.ended || state.kind !== "saved" || receipt.kind !== "saved")
      return false;
    let root: unknown;
    try {
      root = (JSON.parse(receipt.elements) as { root: unknown }).root;
    } catch {
      return false;
    }
    if (imageCount(root, state.url) !== 1) return false;
    if (this.retention && this.retained)
      await this.retention.clear(this.retained);
    this.retained = null;
    return true;
  }
  configure(ports: ImagePorts) {
    this.ports = ports;
  }
  state = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(state: ImageState) {
    this.current = state;
    for (const listener of this.listeners) listener();
  }
  decline() {
    if (this.current.kind === "quote") this.set({ kind: "idle" });
  }
  async generate(prompt: string) {
    await this.restore();
    if (
      this.ended ||
      this.quarantined ||
      (this.retention && this.retained) ||
      ["generating", "saving", "quote", "uncertain"].includes(this.current.kind)
    )
      return;
    // An unsynced image is retained until the user explicitly starts a new generation.
    const availability = this.ports.availability(),
      source = this.ports.source();
    if (source.mode === "local" || !availability.available) {
      this.set({
        kind: "unavailable",
        message:
          source.mode === "local"
            ? "Local AI does not support image generation."
            : (availability.reason ?? IMAGE_UNAVAILABLE),
      });
      return;
    }
    try {
      ImageInput.parse({
        idempotencyKey: "validation",
        prompt,
        acceptedMaximum: availability.maximum,
      });
      this.ports.byok.assertSafe(prompt);
    } catch {
      this.set({
        kind: "failed",
        message: "Image prompt is too large or unsafe.",
      });
      return;
    }
    if (source.mode === "pro") {
      this.set({
        kind: "quote",
        prompt,
        maximum: availability.maximum,
        fixture: availability.fixture,
        operationId: crypto.randomUUID(),
      });
      return;
    }
    const reference = this.ports.byok.reference();
    if (!reference) {
      this.set({
        kind: "unavailable",
        message: "Connect your OpenRouter key on this device.",
      });
      return;
    }
    const key = crypto.randomUUID();
    const intent = ++this.intent;
    this.set({ kind: "generating" });
    try {
      await this.pending(key, prompt, "byok");
      const image = await this.ports.byok.image(reference, prompt);
      if (this.ended || intent !== this.intent) return;
      await this.complete(image, prompt);
    } catch {
      if (
        this.ended ||
        intent !== this.intent ||
        this.current.kind === "completed"
      )
        return;
      if (this.retained) {
        this.set({ kind: "uncertain", key, prompt, source: "byok" });
        return;
      }
      this.set({
        kind: "failed",
        message:
          "Image generation failed. Provider outcome may require checking; regeneration is a new action.",
      });
    }
  }
  private async complete(image: ImageArtifact, prompt: string) {
    const state = {
      kind: "completed" as const,
      image: validateImage(image, this.ports.byok.assertSafe).image,
      prompt,
      uploadId: crypto.randomUUID(),
    };
    this.set(state);
    await this.retain(state);
  }
  async accept() {
    const quote = this.current;
    if (quote.kind !== "quote") return;
    if (
      this.ports.source().mode !== "pro" ||
      !this.ports.availability().available ||
      this.ports.availability().maximum !== quote.maximum
    ) {
      this.set({
        kind: "unavailable",
        message: "Power source or quote changed. Start again.",
      });
      return;
    }
    const intent = ++this.intent;
    this.set({ kind: "generating" });
    try {
      await this.pending(quote.operationId, quote.prompt, "pro");
      const image = await this.ports.pro({
        idempotencyKey: quote.operationId,
        prompt: quote.prompt,
        acceptedMaximum: quote.maximum,
      });
      if (this.ended || intent !== this.intent) return;
      await this.complete(image, quote.prompt);
    } catch {
      if (
        this.ended ||
        intent !== this.intent ||
        this.current.kind === "completed"
      )
        return;
      if (this.retained) {
        this.set({
          kind: "uncertain",
          key: quote.operationId,
          prompt: quote.prompt,
          source: "pro",
        });
        return;
      }
      this.set({
        kind: "failed",
        message:
          "Image action failed or is reconciling. Check Pro history before a new generation.",
      });
    }
  }
  async upload(): Promise<string | null> {
    await this.restore();
    if (this.ended) return null;
    const state = this.current;
    if (state.kind === "saved") return state.url;
    if (state.kind !== "completed" && state.kind !== "sync_failed") return null;
    const intent = ++this.intent;
    this.set({ ...state, kind: "saving" });
    try {
      await this.retain(state);
      const image = validateImage(
        state.image,
        this.ports.byok.assertSafe,
      ).image;
      this.ports.byok.assertEgress(JSON.stringify(image));
      const url = await this.ports.save(state.uploadId, image);
      if (this.ended || intent !== this.intent) return null;
      const saved = { ...state, kind: "saved" as const, url };
      await this.retain(saved);
      this.set(saved);
      return url;
    } catch (error) {
      if (this.ended || intent !== this.intent) return null;
      const expired =
        error instanceof Error && error.message.startsWith("Upload expired");
      const retained = {
        ...state,
        uploadId: expired ? crypto.randomUUID() : state.uploadId,
        kind: "sync_failed" as const,
      };
      try {
        await this.retain(retained);
        this.set(retained);
      } catch {
        this.set({ ...state, kind: "sync_failed" });
      }
      return null;
    }
  }
}
