import type { createByokSession } from "../byok/session";
import {
  AgentCheckpoint,
  DeviceMutation,
  deviceAgentStart,
  deviceAgentFence,
  deviceAgentOutput,
  deviceAgentImage,
  deviceAgentReceipt,
  deviceAgentRestore,
  DEVICE_AGENT_CONFIG,
} from "./device-core";
export type DeviceAgentPorts = {
  account: () => string | undefined;
  session?: () => unknown;
  available: () => boolean;
  images?: () => boolean;
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
  read: () => Promise<unknown>;
  apply: (data: DeviceMutation) => Promise<unknown>;
};
export class DeviceAgent {
  private current: AgentCheckpoint | null = null;
  private persisted: string | null = null;
  private busy = false;
  private ended = false;
  private stopped = false;
  private starting = false;
  private intent = 0;
  private listeners = new Set<() => void>();
  private readonly session: unknown;
  constructor(
    readonly account: string,
    readonly documentId: string,
    private ports: DeviceAgentPorts,
  ) {
    this.session = ports.session?.();
  }
  configure(ports: DeviceAgentPorts) {
    this.ports = ports;
  }
  admitting = () => this.starting;
  private publish() {
    for (const listener of this.listeners) listener();
  }
  private get scope() {
    return JSON.stringify([this.account, this.documentId, DEVICE_AGENT_CONFIG]);
  }
  state = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private active() {
    if (
      this.ports.account() !== this.account ||
      this.ports.session?.() !== this.session
    ) {
      this.ended = true;
      this.current = null;
      void this.ports.store.clear(this.scope, this.persisted).catch(() => {});
    }
    if (this.ended) throw new Error("Account session ended");
  }
  private async persist(value: AgentCheckpoint) {
    this.active();
    const next = AgentCheckpoint.parse({
      ...value,
      fingerprints: this.ports.byok.fingerprints(),
    });
    if (next.account !== this.account || next.documentId !== this.documentId)
      throw new Error("Scope mismatch");
    const data = JSON.stringify(next);
    this.ports.byok.assertEgress(data);
    if (!(await this.ports.store.save(this.scope, data, this.persisted)))
      throw new Error("Local action changed. Restore before continuing.");
    this.persisted = data;
    try {
      this.active();
    } catch {
      await this.ports.store.clear(this.scope, data);
      throw new Error("Account session ended");
    }
    this.current = next;
    for (const listener of this.listeners) listener();
  }
  async restore() {
    this.active();
    const data = await this.ports.store.load(this.scope);
    this.active();
    if (!data) return;
    const state = AgentCheckpoint.parse(JSON.parse(data));
    if (state.account !== this.account || state.documentId !== this.documentId)
      throw new Error("Scope mismatch");
    this.ports.byok.restoreFingerprints(state.fingerprints);
    this.ports.byok.assertEgress(data);
    this.persisted = data;
    await this.persist(deviceAgentRestore(state));
  }
  async start(prompt: string) {
    this.active();
    if (
      this.busy ||
      this.starting ||
      this.current ||
      !this.ports.available() ||
      !this.ports.byok.reference()
    )
      return;
    this.starting = true;
    const intent = ++this.intent;
    this.stopped = false;
    this.publish();
    try {
      this.ports.byok.assertSafe(prompt);
      const reference = this.ports.byok.reference();
      const document = await this.ports.read();
      this.active();
      if (
        intent !== this.intent ||
        this.stopped ||
        this.current ||
        reference !== this.ports.byok.reference() ||
        !this.ports.available()
      )
        return;
      this.ports.byok.assertEgress(JSON.stringify(document));
      await this.persist(
        deviceAgentStart(
          this.account,
          this.documentId,
          crypto.randomUUID(),
          Date.now(),
          prompt,
          document,
        ),
      );
      if (intent === this.intent && !this.stopped)
        await this.run(intent, reference);
    } finally {
      this.starting = false;
      this.publish();
    }
  }
  async resume() {
    this.active();
    if (
      this.busy ||
      this.starting ||
      !this.current ||
      ["unknown", "complete", "blocked"].includes(this.current.status)
    )
      return;
    this.stopped = false;
    await this.run(++this.intent, this.ports.byok.reference());
  }
  private async run(
    intent: number,
    reference: ReturnType<DeviceAgentPorts["byok"]["reference"]>,
  ) {
    this.busy = true;
    try {
      while (this.current && !this.stopped && intent === this.intent) {
        this.active();
        const state = this.current;
        if (["unknown", "complete", "blocked"].includes(state.status)) return;
        if (state.phase === "mutation") {
          // Retained output can be committed/reconciled without a provider key.
          const data = DeviceMutation.parse(state.pending);
          this.ports.byok.assertEgress(JSON.stringify(data));
          this.active();
          try {
            const receipt = await this.ports.apply(data);
            this.active();
            this.ports.byok.assertEgress(JSON.stringify(receipt));
            await this.persist(deviceAgentReceipt(state, receipt));
          } catch {
            this.active();
            await this.persist({
              ...state,
              status: "sync_failed",
              reason:
                "Edit not confirmed. Retry the retained edit to retrieve its receipt. Concurrent changes stop the write; saved edits remain.",
            });
            return;
          }
          continue;
        }
        if (
          !this.ports.available() ||
          !reference ||
          reference !== this.ports.byok.reference()
        ) {
          await this.persist(
            AgentCheckpoint.parse({
              ...state,
              fence: undefined,
              status: "paused",
            }),
          );
          return;
        }
        if (state.phase === "image" && !this.ports.images?.()) {
          await this.persist(
            AgentCheckpoint.parse({
              ...state,
              fence: undefined,
              status: "blocked",
              reason:
                "Images await verified provider access and a complete billable bound. No fallback was used.",
            }),
          );
          return;
        }
        if (!reference) return;
        const fenced = deviceAgentFence(state, Date.now());
        await this.persist(fenced);
        if (fenced.status === "blocked") return;
        this.active();
        if (
          this.stopped ||
          intent !== this.intent ||
          reference !== this.ports.byok.reference() ||
          !this.ports.available()
        ) {
          await this.persist(
            AgentCheckpoint.parse({
              ...state,
              fence: undefined,
              fingerprints: this.ports.byok.fingerprints(),
              status: "paused",
            }),
          );
          return;
        }
        try {
          const next =
            state.phase === "image"
              ? deviceAgentImage(
                  fenced,
                  await this.ports.byok.image(reference, state.imagePrompt),
                )
              : deviceAgentOutput(
                  fenced,
                  await this.ports.byok.agent(reference, fenced),
                );
          this.active();
          await this.persist(next);
          if (this.ports.byok.reference() !== reference) return;
        } catch {
          this.active();
          await this.persist(deviceAgentRestore(fenced));
          return;
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async newAction() {
    this.active();
    if (
      this.busy ||
      !this.current ||
      !["complete", "blocked"].includes(this.current.status) ||
      this.current.pending ||
      this.current.fence
    )
      return;
    await this.ports.store.clear(this.scope, this.persisted);
    this.active();
    if (await this.ports.store.load(this.scope))
      throw new Error("Local action changed. Restore before continuing.");
    this.active();
    this.current = null;
    this.persisted = null;
    for (const listener of this.listeners) listener();
  }
  stop() {
    ++this.intent;
    this.stopped = true;
    this.publish();
  }
  async end() {
    this.ended = true;
    this.stopped = true;
    this.current = null;
    await this.ports.store.clear(this.scope, this.persisted);
    for (const listener of this.listeners) listener();
  }
}
