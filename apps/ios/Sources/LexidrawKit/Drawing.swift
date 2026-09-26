import Foundation
import HTTPTypes
import LexidrawJSON

/// A drawing as the server stores it. The elements are kept as the JSON they
/// came as, so a save sends back what this app doesn't understand unchanged.
public struct StoredDrawing: Sendable {
  public let id: String
  public let title: String
  public let access: Access
  public let elements: [JSONValue]
  public let appState: JSONObject
  /// When it last changed, which a save sends back so the server can refuse
  /// it if someone saved in between.
  public let updatedAt: Date

  /// The colour the web draws it on.
  public var background: String { appState["viewBackgroundColor"]?.stringValue ?? "#ffffff" }
}

extension Session {
  public func drawing(_ id: String) async throws -> StoredDrawing {
    let entity = try await ask { try await $0.entitiesLoad(path: .init(id: id)) }.ok.body.json
    let elements =
      entity.elements.isEmpty ? [] : try JSONValue(parsing: entity.elements).arrayValue ?? []
    let appState = try entity.appState.map { try JSONValue(parsing: $0).objectValue }
    return StoredDrawing(
      id: entity.id, title: entity.title, access: entity.accessLevel == .edit ? .edit : .read,
      elements: elements, appState: (appState ?? nil) ?? [:], updatedAt: entity.updatedAt)
  }
}

/// A save refused because someone else saved the drawing after it was read.
public struct DrawingConflict: Error, Sendable {}

extension Session {
  /// Replaces the drawing's elements, if it is still the revision read at
  /// `ifUnmodifiedSince`, and answers the revision the save made. Every
  /// element goes, deleted ones too, as the web saves them; the app state
  /// is left as it is.
  public func save(drawing id: String, elements: [JSONValue], ifUnmodifiedSince: Date) async throws -> Date {
    let json = JSONValue.array(elements).stringified
    do {
      return try await ask {
        try await $0.entitiesSave(
          path: .init(id: id), body: .json(.init(elements: json, ifUnmodifiedSince: ifUnmodifiedSince)))
      }.ok.body.json.updatedAt
    } catch let refusal as Refusal where refusal.status == 409 {
      throw DrawingConflict()
    }
  }
}

/// Saves a drawing as it is edited, as the web's autosave does: once the
/// edits pause, one save at a time, each against the revision the last one
/// made. A conflict stops the saving until the user chooses whose edits to
/// keep.
public actor DrawingSaver {
  public enum Status: Sendable, Equatable {
    case saved, unsaved, saving, conflict
    case failed(String)
  }

  public private(set) var status = Status.saved
  private let session: Session
  private let id: String
  private var revision: Date
  private let pause: @Sendable () async throws -> Void
  private var unsaved: [JSONValue]?
  private var waiting: Task<Void, Never>?
  private var saving: Task<Void, Never>?
  private var observers: [@Sendable (Status) -> Void] = []

  public init(
    session: Session, drawing id: String, readAt: Date,
    pause: @escaping @Sendable () async throws -> Void = { try await Task.sleep(for: .seconds(1)) }
  ) {
    self.session = session
    self.id = id
    revision = readAt
    self.pause = pause
  }

  /// Calls `observer` with each status from now on.
  public func observe(_ observer: @escaping @Sendable (Status) -> Void) {
    observers.append(observer)
    observer(status)
  }

  private func set(_ status: Status) {
    self.status = status
    for observer in observers { observer(status) }
  }

  /// The drawing now has `elements`; they are saved once the edits pause.
  public func changed(_ elements: [JSONValue]) {
    unsaved = elements
    guard status != .conflict else { return }
    if status != .saving { set(.unsaved) }
    waiting?.cancel()
    waiting = Task { [pause] in
      do { try await pause() } catch { return }
      guard !Task.isCancelled else { return }
      await self.saveNow()
    }
  }

  /// Saves what is unsaved without waiting for the edits to pause, after
  /// any save already on its way.
  public func saveNow() async {
    waiting?.cancel()
    while let saving { await saving.value }
    guard status != .conflict, let elements = unsaved else { return }
    unsaved = nil
    set(.saving)
    let task = Task { await self.save(elements) }
    saving = task
    await task.value
  }

  private func save(_ elements: [JSONValue]) async {
    defer { saving = nil }
    do {
      revision = try await session.save(drawing: id, elements: elements, ifUnmodifiedSince: revision)
      set(unsaved == nil ? .saved : .unsaved)
    } catch {
      if unsaved == nil { unsaved = elements }
      set(error is DrawingConflict ? .conflict : .failed(error.localizedDescription))
    }
  }

  /// Saves these edits over whatever is there now.
  public func keepMine() async {
    do {
      revision = try await session.drawing(id).updatedAt
    } catch {
      set(.failed(error.localizedDescription))
      return
    }
    set(.unsaved)
    await saveNow()
  }
}

/// Where a file an image element shows is stored.
public struct DrawingFileLink: Sendable, Equatable {
  public let id: String
  public let mimeType: String
  public let url: URL

  public init(id: String, mimeType: String, url: URL) {
    self.id = id
    self.mimeType = mimeType
    self.url = url
  }
}

extension Session {
  public func files(ofDrawing id: String) async throws -> [DrawingFileLink] {
    try await ask { try await $0.drawingsFiles(path: .init(id: id)) }.ok.body.json.files.compactMap { file in
      URL(string: file.url).map { DrawingFileLink(id: file.id, mimeType: file.mimeType.rawValue, url: $0) }
    }
  }

  /// The file's bytes, from the store the server keeps them in. The token
  /// is for the server alone, so this goes past the client that adds it.
  public func data(of file: DrawingFileLink) async throws -> Data {
    guard let components = URLComponents(url: file.url, resolvingAgainstBaseURL: false),
      var origin = URLComponents(string: "\(components.scheme ?? "https")://\(components.host ?? "")")
    else { throw URLError(.badURL) }
    origin.port = components.port
    let path = components.percentEncodedPath + (components.percentEncodedQuery.map { "?\($0)" } ?? "")
    let (response, body) = try await connection.transport.send(
      HTTPRequest(method: .get, scheme: nil, authority: nil, path: path), body: nil,
      baseURL: origin.url!, operationID: "drawings-fileData")
    guard response.status.kind == .successful else {
      throw Refusal(status: response.status.code, message: "The file couldn’t be fetched.")
    }
    guard let body else { return Data() }
    return try await Data(collecting: body, upTo: 16 << 20)
  }

  /// Stores a file under the id its image elements carry.
  public func store(_ data: Data, as fileId: String, mimeType: String, inDrawing id: String) async throws {
    _ = try await ask {
      try await $0.drawingsPutFile(
        path: .init(id: id, fileId: fileId),
        body: .json(.init(mimeType: mimeType, dataURL: "data:\(mimeType);base64,\(data.base64EncodedString())")))
    }.ok
  }
}
