export interface LLMEventMap {
  completion: { completion: string; requestId: string };
  error: { error: string; requestId?: string };
  loading: { progress: number; text: string };
  progress: { progress: number; text: string };
  ready: { text: string };
  unknown: { text: string };
}

// Create a discriminated union
export type LLMWorkerMessage = {
  [K in keyof LLMEventMap]: { type: K } & LLMEventMap[K];
}[keyof LLMEventMap];
