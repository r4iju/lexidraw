import type { AgentCheckpoint, DeviceMutation } from "./device-core";
// Compile-only contract: consumers narrow payloads directly by phase and status.
export function checkpointPayloads(state: AgentCheckpoint) {
  if (state.phase === "image") {
    const prompt: string = state.imagePrompt;
    void prompt;
  }
  if (state.phase === "mutation") {
    const mutation: DeviceMutation = state.pending;
    void mutation;
  }
  if (state.status === "unknown") {
    const kind: "unknown" = state.fence.kind;
    void kind;
  }
  if (state.status === "complete") {
    const phase: "decision" = state.phase;
    void phase;
  }
}
export function rejectMissingPayloads(
  image: Extract<AgentCheckpoint, { phase: "image" }>,
  mutation: Extract<AgentCheckpoint, { phase: "mutation" }>,
  unknown: Extract<AgentCheckpoint, { status: "unknown" }>,
) {
  // @ts-expect-error Image checkpoints require their saved prompt.
  const missingImage: AgentCheckpoint = { ...image, imagePrompt: undefined };
  // @ts-expect-error Mutation checkpoints require their retained edit.
  const missingMutation: AgentCheckpoint = { ...mutation, pending: undefined };
  // @ts-expect-error Unknown requests require an unknown fence.
  const missingFence: AgentCheckpoint = { ...unknown, fence: undefined };
  void [missingImage, missingMutation, missingFence];
}
