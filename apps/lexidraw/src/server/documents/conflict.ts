/**
 * What a stale write was about. Documents and drawings share one store, one
 * compare-and-set, and this one error, so the noun is the caller's to supply:
 * a `PUT /drawings/{id}` that lost the race has to say "Drawing", and only the
 * procedure that raised it knows which it was.
 */
export type StaleSubject = "Document" | "Drawing";

/**
 * A write lost the race with another write. Carries the `updatedAt` the
 * entity has now, so the caller can re-read and retry against it. Shared by
 * every precondition-carrying write: document append, insert, and replace,
 * and the drawing put.
 */
export class StaleDocumentError extends Error {
  readonly currentUpdatedAt: Date;

  constructor(currentUpdatedAt: Date, subject: StaleSubject) {
    super(
      `${subject} was modified at ${currentUpdatedAt.toISOString()}; re-read it and retry with the new updatedAt`,
    );
    this.name = "StaleDocumentError";
    this.currentUpdatedAt = currentUpdatedAt;
  }
}
