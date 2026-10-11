import { ThumbnailReceipt } from "./thumbnail-receipt";
import { z } from "zod";
import { Operation } from "~/server/pro/contracts";
export const ImageOperation = Operation.pick({
  id: true,
  state: true,
  result: true,
});
export type ImageOperation = z.infer<typeof ImageOperation>;
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
type Completed = {
  durability: "durable" | "memory_only";
  image: ImageArtifact;
  uploadId: string;
  prompt: string;
  generationKey?: string;
  operation?: ImageOperation;
};
export type ImageState =
  | { kind: "idle" | "declined" }
  | { kind: "unavailable" | "failed"; message: string }
  | {
      kind: "quote";
      prompt: string;
      operationId: string;
      maximum: number;
      fixture: boolean;
    }
  | {
      kind: "uncertain";
      key: string;
      prompt: string;
      source: "pro" | "byok";
      operation?: ImageOperation;
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
  }) => Promise<ImageArtifact | ImageOperation>;
  readPro?: (key: string) => Promise<ImageOperation | null>;
  cancelPro?: (id: string) => Promise<ImageOperation>;
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
  clear: (expected: string) => Promise<boolean>;
};
const RetainedImage = z.strictObject({
  version: z.literal(1),
  owner: z.string().min(1).max(4096),
  fingerprints: CredentialFingerprints.default([]),
  image: ArtifactSchema,
  uploadId: z.uuid(),
  prompt: z.string().min(1).max(1500),
  url: z.url().optional(),
  generationKey: z.uuid().optional(),
  operation: ImageOperation.optional(),
});
const PendingImage = z.strictObject({
  version: z.literal(1),
  owner: z.string().min(1).max(4096),
  fingerprints: CredentialFingerprints.default([]),
  key: z.uuid(),
  prompt: z.string().min(1).max(1500),
  source: z.enum(["pro", "byok"]),
  operation: ImageOperation.optional(),
});
const ReceiptNode = z.looseObject({
  type: z.string(),
  src: z.string().optional(),
  get children(): z.ZodOptional<z.ZodArray<typeof ReceiptNode>> {
    return z.array(ReceiptNode).optional();
  },
});
const ReceiptDocument = z.looseObject({ root: ReceiptNode });
function imageCount(node: z.infer<typeof ReceiptNode>, url: string): number {
  return (
    (node.type === "image" && node.src === url ? 1 : 0) +
    (node.children?.reduce((n, child) => n + imageCount(child, url), 0) ?? 0)
  );
}
export class ImageFlow {
  private current: ImageState = { kind: "idle" };
  private retained: string | null = null;
  private restored?: Promise<void>;
  private ended = false;
  private quarantined = false;
  private intent = 0;
  private persistence: Promise<unknown> = Promise.resolve();
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
    this.set({ kind: "idle" });
  }
  private check(intent: number, ports = this.ports) {
    if (this.ended || intent !== this.intent)
      throw new Error("Image action ended");
    ports.byok.assertSafe("");
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
            operation: pending.data.operation,
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
                durability: "durable",
                image,
                uploadId: value.uploadId,
                prompt: value.prompt,
                generationKey: value.generationKey,
                operation: value.operation,
                url: value.url,
              }
            : {
                kind: "completed",
                durability: "durable",
                image,
                uploadId: value.uploadId,
                prompt: value.prompt,
                generationKey: value.generationKey,
                operation: value.operation,
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
  // A document ACK must clear the revision produced by every earlier owner write.
  private persist<T>(work: () => Promise<T>): Promise<T> {
    const result = this.persistence.then(work);
    this.persistence = result.catch(() => {});
    return result;
  }
  private retain(state: Completed & { url?: string }) {
    const intent = this.intent;
    return this.persist(async () => {
      this.check(intent);
      await this.writeArtifact(state);
    });
  }
  private async writeArtifact(state: Completed & { url?: string }) {
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
        generationKey: state.generationKey,
        operation: state.operation,
      }),
    );
    this.ports.byok.assertSafe(value);
    if (!(await this.retention.save(value, this.retained)))
      throw new Error("Image retention changed or unavailable");
    this.retained = value;
  }
  private async pending(
    key: string,
    prompt: string,
    source: "pro" | "byok",
    operation?: ImageOperation,
  ) {
    const intent = this.intent;
    return this.persist(async () => {
      this.check(intent);
      if (!this.retention) return;
      const raw = JSON.stringify(
        PendingImage.parse({
          version: 1,
          owner: this.retention.owner,
          fingerprints: this.ports.byok.fingerprints(),
          key,
          prompt,
          source,
          operation,
        }),
      );
      this.ports.byok.assertSafe(raw);
      if (!(await this.retention.save(raw, this.retained)))
        throw new Error("Cannot retain image admission");
      this.retained = raw;
    });
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
      const operation = await this.ports.readPro(state.key);
      if (!this.ended && intent === this.intent && operation)
        await this.receive(
          operation,
          state.key,
          state.prompt,
          state.operation?.id,
        );
    } catch {
      /* An owned read preserves uncertainty and cannot dispatch. */
    }
  }
  private async receive(
    outcome: ImageArtifact | ImageOperation,
    key: string,
    prompt: string,
    expectedId?: string,
  ) {
    const intent = this.intent;
    this.check(intent);
    const parsed = ImageOperation.safeParse(outcome);
    if (!parsed.success) {
      await this.complete(outcome, prompt, key);
      return;
    }
    const operation = parsed.data;
    if (expectedId && operation.id !== expectedId)
      throw new Error("Owned image identity changed");
    await this.pending(key, prompt, "pro", operation);
    this.check(intent);
    this.set({ kind: "uncertain", key, prompt, source: "pro", operation });
    if (operation.state === "settled" && operation.result)
      await this.complete(JSON.parse(operation.result), prompt, key, operation);
  }
  async cancel() {
    const state = this.current;
    if (
      this.ended ||
      state.kind !== "uncertain" ||
      !state.operation ||
      !this.ports.cancelPro
    )
      return;
    const intent = this.intent;
    try {
      const operation = await this.ports.cancelPro(state.operation.id);
      if (!this.ended && intent === this.intent)
        await this.receive(
          operation,
          state.key,
          state.prompt,
          state.operation.id,
        );
    } catch {
      /* Cancellation is unconfirmed; preserve the original paid fence. */
    }
  }
  async commitThumbnail(
    identity: string,
    entityId: string,
    previousRevision: number | null,
    commit: () => Promise<unknown>,
  ) {
    const url = await this.upload(identity);
    const state = this.current;
    if (!url || state.kind !== "saved" || state.uploadId !== identity)
      return false;
    const intent = this.intent;
    const parsed = ThumbnailReceipt.safeParse(await commit());
    this.check(intent);
    if (!parsed.success) return false;
    const receipt = parsed.data;
    if (
      receipt.entityId !== entityId ||
      receipt.uploadId !== identity ||
      receipt.revision <= (previousRevision ?? 0) ||
      new URL(receipt.light, url).href !== url ||
      new URL(receipt.dark, url).href !== url
    )
      return false;
    return this.clearSaved(state, intent);
  }
  private clearSaved(
    state: Extract<ImageState, { kind: "saved" }>,
    intent: number,
  ) {
    return this.persist(async () => {
      this.check(intent);
      const current = this.current;
      if (
        current.kind !== "saved" ||
        current.uploadId !== state.uploadId ||
        current.url !== state.url
      )
        return false;
      if (
        this.retention &&
        this.retained &&
        !(await this.retention.clear(this.retained))
      )
        return false;
      this.check(intent);
      this.retained = null;
      this.intent++;
      this.set({ kind: "idle" });
      return true;
    });
  }
  async acknowledge(receipt: SaveReceipt) {
    const state = this.current;
    if (this.ended || state.kind !== "saved" || receipt.kind !== "saved")
      return false;
    const intent = this.intent;
    let document: z.infer<typeof ReceiptDocument>;
    try {
      document = ReceiptDocument.parse(JSON.parse(receipt.elements));
    } catch {
      return false;
    }
    if (imageCount(document.root, state.url) !== 1) return false;
    return this.clearSaved(state, intent);
  }

  async insert(
    insert: (
      url: string,
      prompt: string,
      check: () => void,
    ) => Promise<SaveReceipt | null>,
  ) {
    const url = await this.upload();
    if (!url || this.ended || this.current.kind !== "saved") return false;
    const intent = this.intent;
    const check = () => {
      if (this.ended || intent !== this.intent)
        throw new Error("Image document action ended");
      this.ports.byok.assertSafe(url);
    };
    check();
    const receipt = await insert(url, this.current.prompt, check);
    check();
    return !!receipt && this.acknowledge(receipt);
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
    if (this.current.kind === "quote") this.set({ kind: "declined" });
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
    const ports = this.ports;
    const key = crypto.randomUUID();
    const intent = ++this.intent;
    this.set({ kind: "generating" });
    try {
      await this.pending(key, prompt, "byok");
      this.check(intent, ports);
      if (reference !== ports.byok.reference())
        throw new Error("Image credential changed before dispatch");
      const image = await ports.byok.image(reference, prompt);
      if (this.ended || intent !== this.intent) return;
      await this.complete(image, prompt, key);
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
  private async complete(
    image: unknown,
    prompt: string,
    generationKey?: string,
    operation?: ImageOperation,
  ) {
    const intent = this.intent;
    const state: Completed & { kind: "completed" } = {
      durability: "memory_only",
      kind: "completed",
      image: validateImage(image, this.ports.byok.assertSafe).image,
      prompt,
      uploadId: crypto.randomUUID(),
      generationKey,
      operation,
    };
    try {
      await this.retain(state);
      state.durability = "durable";
    } catch {
      /* Safe output remains in memory; the durable pending fence stays unchanged. */
    }
    this.check(intent);
    this.set(state);
  }
  async retryCheckpoint() {
    const state = this.current;
    if (this.ended || !("image" in state) || state.kind === "saving") return;
    const intent = this.intent;
    await this.persist(async () => {
      if (this.ended || intent !== this.intent || this.current !== state)
        return;
      try {
        this.check(intent);
        await this.writeArtifact(state);
        this.check(intent);
        if (this.current === state)
          this.set({ ...state, durability: "durable" });
      } catch {
        if (this.ended || intent !== this.intent || this.current !== state)
          return;
        try {
          this.check(intent);
        } catch {
          return;
        }
        this.set({ ...state, durability: "memory_only" });
      }
    });
  }
  async accept() {
    const quote = this.current;
    if (this.ended || quote.kind !== "quote") return;
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
    const ports = this.ports;
    const intent = ++this.intent;
    this.set({ kind: "generating" });
    try {
      await this.pending(quote.operationId, quote.prompt, "pro");
      this.check(intent, ports);
      const image = await ports.pro({
        idempotencyKey: quote.operationId,
        prompt: quote.prompt,
        acceptedMaximum: quote.maximum,
      });
      if (this.ended || intent !== this.intent) return;
      await this.receive(image, quote.operationId, quote.prompt);
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
  async upload(identity?: string): Promise<string | null> {
    await this.restore();
    if (this.ended) return null;
    const state = this.current;
    if (
      identity !== undefined &&
      (!("uploadId" in state) || state.uploadId !== identity)
    )
      return null;
    if (state.kind === "saved") return state.url;
    if (state.kind !== "completed" && state.kind !== "sync_failed") return null;
    const ports = this.ports;
    const intent = ++this.intent;
    this.set({ ...state, kind: "saving" });
    try {
      await this.retain(state);
      this.check(intent, ports);
      const image = validateImage(
        state.image,
        this.ports.byok.assertSafe,
      ).image;
      this.ports.byok.assertEgress(JSON.stringify(image));
      const url = await ports.save(state.uploadId, image);
      if (this.ended || intent !== this.intent) return null;
      const saved = { ...state, kind: "saved" as const, url };
      try {
        await this.retain(saved);
        saved.durability = "durable";
      } catch {
        saved.durability = "memory_only";
      }
      this.check(intent, ports);
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
        this.check(intent, ports);
        this.set({ ...retained, durability: "durable" });
      } catch {
        try {
          this.check(intent, ports);
        } catch {
          return null;
        }
        this.set({ ...state, kind: "sync_failed", durability: "memory_only" });
      }
      return null;
    }
  }
}
