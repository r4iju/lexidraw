import Foundation
import LexidrawJSON
import Synchronization
import Testing

@testable import LexidrawKit

@Suite struct DrawingTests {
  static func loaded(elements: String, appState: String = "null", access: String = "EDIT") -> String {
    """
    {"id":"d1","title":"Floor plan","entityType":"drawing","appState":\(appState),
     "elements":\(elements),"publicAccess":"PRIVATE","shared":false,"accessLevel":"\(access)",
     "updatedAt":"2026-09-25T09:30:00.123Z"}
    """
  }

  /// A later save must send these elements back as they came, fields this app
  /// doesn't know included, so they are kept as JSON and not as a model.
  @Test func opensADrawingWithItsElementsAsStored() async throws {
    let elements = #"[{"id":"r","type":"rectangle","x":1,"customData":{"kept":true}},{"id":"w","type":"widget"}]"#
    let server = FakeServer { _ in
      (200, Self.loaded(elements: try String(data: JSONEncoder().encode(elements), encoding: .utf8)!))
    }
    let session = try TestServer.session(server)

    let drawing = try await session.drawing("d1")

    #expect(drawing.title == "Floor plan")
    #expect(drawing.access == .edit)
    #expect(drawing.elements.map { $0["id"] } == ["r", "w"])
    #expect(drawing.elements.first?["customData"] == ["kept": true])
    #expect(drawing.updatedAt == Date(timeIntervalSince1970: 1_790_328_600.123))
    #expect(try #require(server.requests.only).url.path == "/api/v1/entities/d1")
  }

  /// The web draws on the saved background colour, and on white when the
  /// drawing has no app state.
  @Test func drawsOnTheSavedBackground() async throws {
    let server = FakeServer { request in
      request.url.path.hasSuffix("d1")
        ? (200, Self.loaded(elements: #""[]""#, appState: ##""{\"viewBackgroundColor\":\"#fdf6e3\"}""##))
        : (200, Self.loaded(elements: #""[]""#))
    }
    let session = try TestServer.session(server)

    #expect(try await session.drawing("d1").background == "#fdf6e3")
    #expect(try await session.drawing("d2").background == "#ffffff")
  }
}

@Suite struct DrawingSaveTests {
  static let read = Date(timeIntervalSince1970: 1_790_328_600.123)
  static let saved = #"{"id":"d1","updatedAt":"2026-09-25T09:31:00.456Z"}"#

  /// Whatever was read comes back as it was, written as the web's
  /// `JSON.stringify` writes it, deleted elements too, as the web sends them
  /// so a peer can tell a deletion from an element it never had; the app
  /// state, which this app doesn't edit, is left alone.
  @Test func savesTheElementsAgainstTheRevisionItRead() async throws {
    let server = FakeServer { _ in (200, Self.saved) }
    let session = try TestServer.session(server)
    let read = #"[{"type":"rectangle","id":"r","link":"https://x.test/a","customData":{"kept":true,"at":0.1}},"#
      + #"{"id":"gone","type":"ellipse","isDeleted":true}]"#
    let elements = try #require(JSONValue(parsing: read).arrayValue)

    let updatedAt = try await session.save(drawing: "d1", elements: elements, ifUnmodifiedSince: Self.read)

    let request = try #require(server.requests.only)
    #expect(request.method == .put)
    #expect(request.url.path == "/api/v1/entities/d1")
    #expect(request.json["ifUnmodifiedSince"] == "2026-09-25T09:30:00.123Z")
    #expect(!request.keys.contains("appState"))
    #expect(request.json["elements"] == read)
    #expect(updatedAt == Date(timeIntervalSince1970: 1_790_328_660.456))
  }

  /// Someone saved since it was read: the save is refused, not merged.
  @Test func aSaveOverAnotherIsAConflict() async throws {
    let server = FakeServer { _ in
      (409, #"{"message":"Drawing was modified at 2026-09-25T09:30:30.000Z","code":"CONFLICT"}"#)
    }
    let session = try TestServer.session(server)

    await #expect(throws: DrawingConflict.self) {
      try await session.save(drawing: "d1", elements: [], ifUnmodifiedSince: Self.read)
    }
  }
}

@Suite struct DrawingSaverTests {
  /// Stands for the pause after an edit: the saver waits until a test lets
  /// it go on.
  final class Pause: Sendable {
    private let waiting = Mutex<[CheckedContinuation<Void, Never>]>([])

    func wait() async {
      await withCheckedContinuation { continuation in waiting.withLock { $0.append(continuation) } }
    }

    /// Ends every pause begun so far.
    func end() {
      for continuation in waiting.withLock({ list in defer { list = [] }; return list }) {
        continuation.resume()
      }
    }

    var count: Int { waiting.withLock { $0.count } }
  }

  static func sentElements(_ request: FakeServer.Request) throws -> [JSONValue] {
    try JSONDecoder().decode([JSONValue].self, from: Data(try #require(request.json["elements"]).utf8))
  }

  static func settle(_ condition: @escaping () async -> Bool) async {
    for _ in 0..<2000 where !(await condition()) { try? await Task.sleep(for: .milliseconds(1)) }
  }

  /// Edits in quick succession make one save, of where they ended.
  @Test func savesOnceEditingPauses() async throws {
    let server = FakeServer { _ in (200, DrawingSaveTests.saved) }
    let pause = Pause()
    let saver = DrawingSaver(
      session: try TestServer.session(server), drawing: "d1", readAt: DrawingSaveTests.read,
      pause: { await pause.wait() })

    await saver.changed([["id": "a"]])
    await saver.changed([["id": "a"], ["id": "b"]])
    await Self.settle { pause.count == 2 }
    pause.end()
    await Self.settle { await saver.status == .saved }

    let request = try #require(server.requests.only)
    #expect(try Self.sentElements(request) == [["id": "a"], ["id": "b"]])
  }

  /// Each save is against the revision the one before it made.
  @Test func eachSaveFollowsTheLast() async throws {
    let answers = Mutex([
      #"{"id":"d1","updatedAt":"2026-09-25T09:31:00.000Z"}"#,
      #"{"id":"d1","updatedAt":"2026-09-25T09:32:00.000Z"}"#,
    ])
    let server = FakeServer { _ in (200, answers.withLock { $0.removeFirst() }) }
    let saver = DrawingSaver(
      session: try TestServer.session(server), drawing: "d1", readAt: DrawingSaveTests.read, pause: {})

    await saver.changed([["id": "a"]])
    await saver.saveNow()
    await saver.changed([["id": "b"]])
    await saver.saveNow()

    #expect(
      server.requests.map { $0.json["ifUnmodifiedSince"] } == [
        "2026-09-25T09:30:00.123Z", "2026-09-25T09:31:00.000Z",
      ])
  }

  /// A refused save stops saving until the user chooses; keeping theirs
  /// is a reload, keeping these edits saves them over the revision that
  /// is there now.
  @Test func aConflictWaitsForAChoice() async throws {
    let conflicted = Mutex(true)
    let server = FakeServer { request in
      if request.method == .get {
        return (
          200,
          DrawingTests.loaded(elements: #""[]""#).replacingOccurrences(
            of: "09:30:00.123Z", with: "09:30:30.000Z")
        )
      }
      return conflicted.withLock { $0 }
        ? (409, #"{"message":"Drawing was modified at 2026-09-25T09:30:30.000Z","code":"CONFLICT"}"#)
        : (200, DrawingSaveTests.saved)
    }
    let saver = DrawingSaver(
      session: try TestServer.session(server), drawing: "d1", readAt: DrawingSaveTests.read, pause: {})

    await saver.changed([["id": "a"]])
    await saver.saveNow()
    #expect(await saver.status == .conflict)
    await saver.changed([["id": "a"], ["id": "b"]])
    await saver.saveNow()
    #expect(server.requests.count == 1)

    conflicted.withLock { $0 = false }
    await saver.keepMine()

    #expect(await saver.status == .saved)
    let last = try #require(server.requests.last)
    #expect(last.json["ifUnmodifiedSince"] == "2026-09-25T09:30:30.000Z")
    #expect(try Self.sentElements(last) == [["id": "a"], ["id": "b"]])
  }
}

@Suite struct DrawingFileTests {
  /// The images a drawing shows are stored apart from it, each under the
  /// id its image elements carry.
  @Test func listsTheFilesADrawingShows() async throws {
    let server = FakeServer { _ in
      (
        200,
        #"{"files":[{"id":"abc","mimeType":"image/png","url":"https://blob.test/drawings/d1/files/abc.png","created":1}]}"#
      )
    }
    let session = try TestServer.session(server)

    let files = try await session.files(ofDrawing: "d1")

    #expect(files == [DrawingFileLink(id: "abc", mimeType: .png, url: URL(string: "https://blob.test/drawings/d1/files/abc.png")!)])
    #expect(try #require(server.requests.only).url.path == "/api/v1/drawings/d1/files")
  }

  /// A file's bytes come from where it is stored, which is not the server,
  /// so the token isn't sent there.
  @Test func fetchesAFileWithoutTheToken() async throws {
    let server = FakeServer { _ in (200, "picture bytes") }
    let session = try TestServer.session(server)
    let link = DrawingFileLink(
      id: "abc", mimeType: .png, url: URL(string: "https://blob.test/drawings/d1/files/abc.png?v=1")!)

    let data = try await session.data(of: link)

    #expect(data == Data("picture bytes".utf8))
    let request = try #require(server.requests.only)
    #expect(request.url.string == "https://blob.test/drawings/d1/files/abc.png?v=1")
    #expect(request.authorization == nil)
  }

  /// A file the server won't take, for what it is or because the drawing
  /// has no room for it, won't be taken when sent again either.
  @Test(arguments: [400, 413])
  func aRefusedFileIsRefusedForGood(_ status: Int) async throws {
    let server = FakeServer { _ in (status, #"{"message":"The drawing is full","code":"X"}"#) }
    let session = try TestServer.session(server)

    let refusal = await #expect(throws: FileRefused.self) {
      try await session.store(Data([1, 2, 3]), as: "abc", mimeType: .png, inDrawing: "d1")
    }
    #expect(refusal?.reason == "The drawing is full")
  }

  /// No file a drawing stores is larger, so a larger answer isn't one.
  @Test func refusesAFileLargerThanADrawingStores() async throws {
    let server = FakeServer { _ in (200, String(repeating: "x", count: maxDrawingFileBytes + 1)) }
    let session = try TestServer.session(server)
    let link = DrawingFileLink(id: "abc", mimeType: .png, url: URL(string: "https://blob.test/abc.png")!)

    await #expect(throws: (any Error).self) { try await session.data(of: link) }
  }

  /// A file is sent as the web sends it: a data URL of its type.
  @Test func storesAFileAsADataURL() async throws {
    let server = FakeServer { _ in (200, #"{"id":"abc","mimeType":"image/png","created":1}"#) }
    let session = try TestServer.session(server)

    try await session.store(Data([1, 2, 3]), as: "abc", mimeType: .png, inDrawing: "d1")

    let request = try #require(server.requests.only)
    #expect(request.method == .put)
    #expect(request.url.path == "/api/v1/drawings/d1/files/abc")
    #expect(request.json == ["mimeType": "image/png", "dataURL": "data:image/png;base64,AQID"])
  }
}
