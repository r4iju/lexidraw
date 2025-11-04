import type { AgentEvent } from "@packages/types";

/**
 * Shared event store for workflow streaming.
 * Phase 2: Temporary in-memory store
 * Phase 4: Will integrate with workflow hooks properly
 */
class WorkflowEventStore {
  private events = new Map<string, AgentEvent[]>();
  private listeners = new Map<string, ((event: AgentEvent) => void)[]>();

  /**
   * Register a listener for events from a specific runId
   * If runId is empty string, listens to all events
   */
  on(runId: string, callback: (event: AgentEvent) => void): () => void {
    if (!this.listeners.has(runId)) {
      this.listeners.set(runId, []);
    }
    const callbacks = this.listeners.get(runId);
    if (callbacks) {
      callbacks.push(callback);
    }

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(runId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  /**
   * Emit an event for a specific runId
   */
  emit(runId: string, event: AgentEvent): void {
    // Store event
    if (!this.events.has(runId)) {
      this.events.set(runId, []);
    }
    const events = this.events.get(runId);
    if (events) {
      events.push(event);
    }

    // Notify listeners for this runId
    const callbacks = this.listeners.get(runId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(event);
        } catch (error) {
          console.error("[WorkflowEventStore] Error in listener:", error);
        }
      }
    }

    // Also notify listeners for all events (empty string key)
    const allCallbacks = this.listeners.get("");
    if (allCallbacks) {
      for (const callback of allCallbacks) {
        try {
          callback(event);
        } catch (error) {
          console.error("[WorkflowEventStore] Error in listener:", error);
        }
      }
    }
  }

  /**
   * Get all events for a runId
   */
  getEvents(runId: string): AgentEvent[] {
    return this.events.get(runId) ?? [];
  }

  /**
   * Clear events for a runId
   */
  clear(runId: string): void {
    this.events.delete(runId);
    this.listeners.delete(runId);
  }
}

export const workflowEventStore = new WorkflowEventStore();
