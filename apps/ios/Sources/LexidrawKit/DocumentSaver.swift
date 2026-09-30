import Foundation
import LexidrawJSON

/// Defers serialization until edits pause and saves one revision at a time.
/// A conflict keeps the pending state available without overwriting theirs.
public actor DocumentSaver {
  public enum Status: Equatable, Sendable {
    case saved, unsaved, saving, conflict
    case failed(String)
  }

  public typealias Snapshot = @Sendable () async throws -> JSONValue
  public private(set) var status = Status.saved
  private let session: Session
  private var id: String
  private var revision: Date
  private let pause: @Sendable () async throws -> Void
  private var pending: Snapshot?
  private var waiting: Task<Void, Never>?
  private var saving: Task<Void, Never>?
  private var observer: (@Sendable (Status) -> Void)?
  private var conflicted = false
  private var generation = 0
  /// Retained if copying settings fails, so retrying cannot create duplicates.
  private var copy: Entry?
  private var copyID: String?
  private var copying = false

  public init(
    session: Session, document: String, readAt: Date,
    pause: @escaping @Sendable () async throws -> Void = { try await Task.sleep(for: .seconds(1)) }
  ) {
    self.session = session
    id = document
    revision = readAt
    self.pause = pause
  }

  public func observe(_ observer: @escaping @Sendable (Status) -> Void) {
    self.observer = observer
    observer(status)
  }

  public func changed(_ snapshot: @escaping Snapshot) {
    generation += 1
    pending = snapshot
    waiting?.cancel()
    guard !conflicted else { return }
    set(.unsaved)
    waiting = Task {
      do {
        try await pause()
        try Task.checkCancellation()
      } catch { return }
      await saveNow()
    }
  }

  public func saveNow() async {
    waiting?.cancel()
    waiting = nil
    while let saving { await saving.value }
    guard !conflicted, let snapshot = pending else { return }
    pending = nil
    set(.saving)
    let task = Task {
      await save(snapshot)
      self.saving = nil
    }
    saving = task
    await task.value
  }

  /// Saves to a new file at Home, never over the newer revision. A partially
  /// created copy is reused on retry while the original remains untouched.
  public func keepMineAsCopy(title: String, appState: JSONValue?) async throws -> StoredDocument {
    guard conflicted, !copying, let snapshot = pending else { throw DocumentCopyUnavailable() }
    copying = true
    defer { copying = false }
    let capturedGeneration = generation
    do {
      let state = try await snapshot()
      if copy == nil {
        let id = copyID ?? UUID().uuidString.lowercased()
        copyID = id
        copy = try await session.create(
          .document, title: "\(title) (copy)", elements: state.stringified, in: nil, id: id)
      }
      guard let copy else { throw DocumentCopyUnavailable() }
      let saved = try await session.saveCopiedDocument(
        copy.id, state: state, appState: appState, readAt: copy.updatedAt)
      id = copy.id
      revision = saved
      self.copy = nil
      copyID = nil
      if generation == capturedGeneration { pending = nil }
      conflicted = false
      set(pending == nil ? .saved : .unsaved)
      return StoredDocument(
        id: id, title: copy.title, access: .edit, state: state, appState: appState, updatedAt: saved
      )
    } catch {
      set(.failed(error.localizedDescription))
      throw error
    }
  }

  private func save(_ snapshot: @escaping Snapshot) async {
    do {
      let state = try await snapshot()
      revision = try await session.save(document: id, state: state, ifUnmodifiedSince: revision)
      set(pending == nil ? .saved : .unsaved)
    } catch {
      if pending == nil { pending = snapshot }
      conflicted = error is DocumentConflict
      set(conflicted ? .conflict : .failed(error.localizedDescription))
    }
  }

  private func set(_ status: Status) {
    self.status = status
    observer?(status)
  }
}

public struct DocumentCopyUnavailable: Error, Sendable {}
