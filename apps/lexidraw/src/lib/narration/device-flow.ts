import type { createByokSession } from "../byok/session";
import {
  DeviceCheckpoint,
  restoreDeviceCheckpoint,
  validateRecording,
  type RecordingArtifact,
} from "./device-contracts";
import { narrationTexts } from "./portable";
export type DeviceNarrationPorts = {
  account: () => string | undefined;
  available: () => boolean;
  session?: () => number;
  ready?: () => Promise<void>;
  byok: ReturnType<typeof createByokSession>;
  store: {
    load(scope: string): Promise<string | null>;
    save(
      scope: string,
      data: string,
      expected: string | null,
    ): Promise<boolean>;
    clear(scope: string, expected?: string | null): Promise<void>;
  };
  sync: (id: string, recording: RecordingArtifact) => Promise<string>;
};
export class DeviceNarration {
  private current: DeviceCheckpoint | null = null;
  private busy = false;
  private intent = 0;
  private starting = false;
  private ended = false;
  private quarantined = false;
  private persisted: string | null = null;
  private restoring?: Promise<void>;
  private listeners = new Set<() => void>();
  readonly generation: number | undefined;
  constructor(
    readonly account: string,
    readonly documentId: string,
    private ports: DeviceNarrationPorts,
  ) {
    this.generation = ports.session?.();
  }
  configure(ports: DeviceNarrationPorts) {
    this.ports = ports;
  }
  private get scope() {
    return JSON.stringify([this.account, this.documentId]);
  }
  async prepare() {
    await this.ports.ready?.();
    this.checkScope();
  }
  state = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private checkScope() {
    if (
      (this.ports.account() !== this.account ||
        this.ports.session?.() !== this.generation) &&
      !this.ended
    ) {
      this.ended = true;
      this.current = null;
      void this.ports.store.clear(this.scope, this.persisted).catch(() => {});
      for (const listener of this.listeners) listener();
    }
    if (this.ended) throw new Error("Account session ended");
  }
  private async persist(value: unknown) {
    this.checkScope();
    const validated = DeviceCheckpoint.parse(value);
    validated.fingerprints = this.ports.byok.fingerprints();
    if (
      validated.account !== this.account ||
      validated.documentId !== this.documentId
    )
      throw new Error("Account scope mismatch");
    const data = JSON.stringify(validated);
    this.ports.byok.assertEgress(data);
    for (const part of validated.parts)
      if (part.kind === "completed")
        validateRecording(
          {
            mimeType: "audio/wav",
            parts: [
              { text: part.text, audio: part.audio, seconds: part.seconds },
            ],
          },
          this.ports.byok.assertSafe,
        );
    if (!(await this.ports.store.save(this.scope, data, this.persisted)))
      throw new Error(
        "Local narration changed in another controller. Restore before continuing.",
      );
    this.persisted = data;
    this.checkScope();
    this.current = validated;
    for (const listener of this.listeners) listener();
  }
  restore() {
    if (this.restoring) return this.restoring;
    this.restoring = this.restoreCheckpoint().finally(() => {
      this.restoring = undefined;
    });
    return this.restoring;
  }
  private async restoreCheckpoint() {
    await this.prepare();
    const data = await this.ports.store.load(this.scope);
    this.checkScope();
    if (!data) return;
    this.quarantined = true;
    this.persisted = data;
    const value = restoreDeviceCheckpoint(JSON.parse(data));
    this.ports.byok.restoreFingerprints(value.fingerprints);
    this.ports.byok.assertEgress(data);
    const parts = value.parts.map((part) =>
      part.kind === "started" ? { ...part, kind: "unknown" } : part,
    );
    const status = parts.some((p) => p.kind === "unknown")
      ? "unknown"
      : value.status === "running"
        ? "paused"
        : value.status === "syncing"
          ? "sync_failed"
          : value.status;
    await this.persist({ ...value, parts, status });
    this.quarantined = false;
  }
  async start(source: string | (() => Promise<string>)) {
    if (this.quarantined) return;
    const admitted = this.intent;
    await this.restore();
    if (admitted !== this.intent || this.ended) return;
    if (
      this.busy ||
      this.starting ||
      this.current ||
      this.quarantined ||
      !this.ports.available()
    )
      return;
    const reference = this.ports.byok.reference();
    if (!reference) return;
    const intent = ++this.intent;
    this.starting = true;
    try {
      const text = typeof source === "string" ? source : await source();
      this.checkScope();
      if (
        intent !== this.intent ||
        this.current ||
        reference !== this.ports.byok.reference() ||
        !this.ports.available()
      )
        return;
      this.ports.byok.assertSafe(text);
      await this.persist({
        version: 1,
        fingerprints: [],
        account: this.account,
        documentId: this.documentId,
        id: crypto.randomUUID(),
        created: Date.now(),
        status: "paused",
        parts: narrationTexts(text).map((text) => ({ kind: "pending", text })),
      });
      if (intent === this.intent && reference === this.ports.byok.reference())
        await this.resume();
    } finally {
      this.starting = false;
    }
  }
  async resume() {
    const admitted = this.intent;
    await this.prepare();
    if (admitted !== this.intent || this.ended) return;
    if (
      this.busy ||
      this.quarantined ||
      !this.current ||
      !this.ports.available() ||
      !this.ports.byok.reference() ||
      this.current.parts.some(
        (p) => p.kind === "unknown" || p.kind === "started",
      ) ||
      this.current.parts.every((p) => p.kind === "completed") ||
      Date.now() - this.current.created > 1_200_000
    )
      return;
    const reference = this.ports.byok.reference();
    const intent = ++this.intent;
    this.busy = true;
    try {
      for (let index = 0; index < this.current.parts.length; index++) {
        this.checkScope();
        const part = this.current.parts[index];
        if (part?.kind !== "pending") continue;
        if (
          !reference ||
          intent !== this.intent ||
          reference !== this.ports.byok.reference() ||
          !this.ports.available()
        )
          break;
        this.ports.byok.assertSafe(part.text);
        await this.persist({
          ...this.current,
          status: "running",
          parts: this.current.parts.map((p, i) =>
            i === index ? { kind: "started", text: p.text } : p,
          ),
        });
        // Persistence may yield to removal/logout; check immediately before transport dispatch.
        this.checkScope();
        if (
          intent !== this.intent ||
          this.ports.byok.reference() !== reference ||
          !this.ports.available()
        ) {
          await this.persist({
            ...this.current,
            status: "paused",
            parts: this.current.parts.map((p, i) =>
              i === index ? { kind: "pending", text: p.text } : p,
            ),
          });
          break;
        }
        try {
          const audio = await this.ports.byok.narrate(reference, part.text);
          await this.complete(index, audio.audio);
        } catch {
          this.checkScope();
          await this.persist({
            ...this.current,
            status: "unknown",
            parts: this.current.parts.map((p, i) =>
              i === index ? { kind: "unknown", text: p.text } : p,
            ),
          });
          return;
        }
      }
      await this.persist({
        ...this.current,
        status: this.current.parts.every((p) => p.kind === "completed")
          ? "completed"
          : "paused",
      });
    } finally {
      this.busy = false;
    }
  }
  private async complete(index: number, audio: string) {
    this.checkScope();
    if (!this.current) return;
    const id = this.current.id,
      text = this.current.parts[index]?.text;
    const data = await this.ports.store.load(this.scope);
    this.checkScope();
    if (!data) throw new Error("Local fence missing");
    const latest = DeviceCheckpoint.parse(JSON.parse(data));
    this.ports.byok.restoreFingerprints(latest.fingerprints);
    this.ports.byok.assertEgress(data);
    if (
      latest.id !== id ||
      latest.account !== this.account ||
      latest.documentId !== this.documentId ||
      latest.parts[index]?.text !== text ||
      !["started", "unknown"].includes(latest.parts[index]?.kind ?? "")
    )
      throw new Error("Local fence changed");
    const { validateWav } = await import("./portable");
    this.checkScope();
    const { seconds } = validateWav(audio, this.ports.byok.assertSafe);
    this.persisted = data;
    this.current = latest;
    const parts = latest.parts.map((p, i) =>
      i === index
        ? { kind: "completed" as const, text: p.text, audio, seconds }
        : p,
    );
    await this.persist({
      ...latest,
      status: parts.every((p) => p.kind === "completed")
        ? "completed"
        : "paused",
      parts,
    });
  }
  async confirm(index: number, audio: string) {
    this.checkScope();
    if (this.busy || this.current?.parts[index]?.kind !== "unknown") return;
    await this.complete(index, audio);
  }
  async sync() {
    await this.prepare();
    if (this.busy || !this.current || this.current.status === "saved") return;
    const parts = this.current.parts.flatMap((p) =>
      p.kind === "completed"
        ? [{ text: p.text, audio: p.audio, seconds: p.seconds }]
        : [],
    );
    if (parts.length !== this.current.parts.length) return;
    this.busy = true;
    try {
      await this.persist({ ...this.current, status: "syncing" });
      const recording = validateRecording(
        { mimeType: "audio/wav", parts },
        this.ports.byok.assertSafe,
      );
      this.checkScope();
      this.ports.byok.assertEgress(JSON.stringify(recording));
      const recordingId = await this.ports.sync(
        this.current.uploadKey ?? this.current.id,
        recording,
      );
      await this.persist({ ...this.current, status: "saved", recordingId });
    } catch (error) {
      this.checkScope();
      await this.persist({
        ...this.current,
        uploadKey:
          error instanceof Error && error.message.startsWith("Upload expired")
            ? crypto.randomUUID()
            : (this.current.uploadKey ?? this.current.id),
        status: "sync_failed",
      });
    } finally {
      this.busy = false;
    }
  }
  stop() {
    ++this.intent;
  }
  async end() {
    this.stop();
    this.ended = true;
    this.current = null;
    await this.ports.store.clear(this.scope, this.persisted);
    for (const listener of this.listeners) listener();
  }
}
