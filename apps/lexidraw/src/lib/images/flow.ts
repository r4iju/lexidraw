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
export class ImageFlow {
  private current: ImageState = { kind: "idle" };
  private listeners = new Set<() => void>();
  constructor(private ports: ImagePorts = unavailablePorts) {}
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
    if (["generating", "saving", "quote"].includes(this.current.kind)) return;
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
    this.set({ kind: "generating" });
    try {
      this.complete(await this.ports.byok.image(reference, prompt), prompt);
    } catch {
      this.set({
        kind: "failed",
        message:
          "Image generation failed. Provider outcome may require checking; regeneration is a new action.",
      });
    }
  }
  private complete(image: ImageArtifact, prompt: string) {
    this.set({
      kind: "completed",
      image: validateImage(image, this.ports.byok.assertSafe).image,
      prompt,
      uploadId: crypto.randomUUID(),
    });
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
    this.set({ kind: "generating" });
    try {
      this.complete(
        await this.ports.pro({
          idempotencyKey: quote.operationId,
          prompt: quote.prompt,
          acceptedMaximum: quote.maximum,
        }),
        quote.prompt,
      );
    } catch {
      this.set({
        kind: "failed",
        message:
          "Image action failed or is reconciling. Check Pro history before a new generation.",
      });
    }
  }
  async upload(): Promise<string | null> {
    const state = this.current;
    if (state.kind === "saved") return state.url;
    if (state.kind !== "completed" && state.kind !== "sync_failed") return null;
    this.set({ ...state, kind: "saving" });
    try {
      const image = validateImage(
        state.image,
        this.ports.byok.assertSafe,
      ).image;
      this.ports.byok.assertEgress(JSON.stringify(image));
      const url = await this.ports.save(state.uploadId, image);
      this.set({ ...state, kind: "saved", url });
      return url;
    } catch (error) {
      const expired =
        error instanceof Error && error.message.startsWith("Upload expired");
      this.set({
        ...state,
        uploadId: expired ? crypto.randomUUID() : state.uploadId,
        kind: "sync_failed",
      });
      return null;
    }
  }
}
