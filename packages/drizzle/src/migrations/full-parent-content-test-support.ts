import type { MigrationExecutor } from "./file-migration-owner.js";
import type { ContentState } from "./full-parent-content-destination-v1.js";

export interface FullParentContentCaseInput {
  executor: MigrationExecutor;
  write<T>(work: (executor: MigrationExecutor) => Promise<T>): Promise<T>;
  inspect(executor: MigrationExecutor): Promise<ContentState>;
  compare(actual: unknown, expected: unknown, label: string): void;
  record(label: string, value: unknown): void;
}
