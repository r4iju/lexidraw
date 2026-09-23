/**
 * A write lost the race with another write. Carries the `updatedAt` the
 * document has now, so the caller can re-read and retry against it. Shared by
 * every precondition-carrying document write: append, insert, and replace.
 */
export class StaleDocumentError extends Error {
  readonly currentUpdatedAt: Date;

  constructor(currentUpdatedAt: Date) {
    super(
      `Document was modified at ${currentUpdatedAt.toISOString()}; re-read it and retry with the new updatedAt`,
    );
    this.name = "StaleDocumentError";
    this.currentUpdatedAt = currentUpdatedAt;
  }
}
